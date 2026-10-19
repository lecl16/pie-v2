/**
 * @format
 *
 * Secure provisioning app flow — this app is the trusted node (see
 * pie-api-main/docs/examiner-trusted-node-provisioning.md):
 * 1) Examiner logs in (teacher/admin JWT, same as WebApp).
 * 2) App generates a session secret and registers it with pie-api-main for
 *    one device + session.
 * 3) App enables HCE secure mode with that secret, the session data and the
 *    server URL.
 * 4) Reader sends its per-tap public key (INS CB), then requests the
 *    encrypted payload (INS CC), then confirms the secret with the server.
 *
 * After login the app also enrolls the phone (once): it gets a client
 * certificate for a key kept in the Android Keystore, and sends the
 * trusted-node calls (device creation, provisioning secrets) to the API's
 * phone port with it — see pie-api-main/docs/examiner-phone-enrollment.md.
 */

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  NativeModules,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useColorScheme,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

const { NfcHceModule, PhoneCredentialModule } = NativeModules;

// Matches ExamHceService.kt's handleGetProvisionToken(), which reads
// sessionId/nmec/apiBaseUrl/ttlSec from this JSON and ignores anything else.
// ttlSec only governs how long the encrypted payload built at tap time is
// valid for, so it stays a fixed local default.
const TOKEN_TTL_SECONDS = 60;

// How long the server keeps the registered secret confirmable — i.e. how
// long the examiner has to tap after activating. Matches the reader's
// MAX_WINDOW_SECONDS.
const SECRET_TTL_SECONDS = 300;

interface ProvisionRegistration {
  sessionId: string;
  nmec: string;
}

interface NativeHceModule {
  generateSecret?: () => Promise<string>;
  setSecureProvisioning?: (payloadJson: string, sharedSecretBase64Url: string) => void;
  clearExamData?: () => void;
  setPendingDeviceIdentity?: (identityJson: string) => void;
  clearPendingDeviceIdentity?: () => void;
}

// Matches ExamHceService.kt's handleGetDeviceIdentity(), which reads exactly
// these three fields and ignores anything else.
interface DeviceIdentity {
  deviceId: number;
  apiKey: string;
  apiBaseUrl: string;
}

const nfcHceModule = NfcHceModule as NativeHceModule | undefined;

interface PhoneCredentialStatus {
  enrolled: boolean;
  fingerprint?: string;
  subject?: string;
  expiresAt?: number;
  mtlsPort?: number;
}

interface NativePhoneCredentialModule {
  getStatus: () => Promise<PhoneCredentialStatus>;
  createCsr: () => Promise<string>;
  storeCertificate: (certificatePem: string, mtlsPort: number) => Promise<PhoneCredentialStatus>;
  clear: () => Promise<void>;
}

const phoneCredentialModule = PhoneCredentialModule as NativePhoneCredentialModule | undefined;

// Re-enroll this long before the phone's certificate expires.
const RENEW_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

// The same server, on the port that requires the phone's certificate.
function withPort(baseUrl: string, port: number): string {
  return baseUrl.replace(/^(https:\/\/(?:\[[^\]]+\]|[^/:]+))(?::\d+)?/i, `$1:${port}`);
}

function phoneLabel(): string {
  const constants = Platform.constants as { Brand?: string; Model?: string };
  return [constants.Brand, constants.Model].filter(Boolean).join(' ').slice(0, 100);
}

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent(): React.JSX.Element {
  const insets = useSafeAreaInsets();

  const [active, setActive] = useState(false);
  const [status, setStatus] = useState('Log in, then pick a device to provision.');
  const [busy, setBusy] = useState(false);

  const [apiBaseUrl, setApiBaseUrl] = useState('https://REPLACE-WITH-YOUR-PIE-API-HOST:8000');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loggedInAs, setLoggedInAs] = useState<string | null>(null);

  // Base URL of the phone port once this phone's certificate is accepted
  // there; null until then, and the trusted-node actions stay disabled.
  const [phoneBaseUrl, setPhoneBaseUrl] = useState<string | null>(null);
  const [phoneStatus, setPhoneStatus] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);

  const [courseId, setCourseId] = useState('');
  const [examId, setExamId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [studentNmec, setStudentNmec] = useState('');

  const [newDeviceName, setNewDeviceName] = useState('');
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [pendingIdentity, setPendingIdentity] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [deviceStatus, setDeviceStatus] = useState(
    'Provisioning a new device holds its identity here until the next NFC tap.',
  );

  const baseUrl = useCallback(() => apiBaseUrl.trim().replace(/\/$/, ''), [apiBaseUrl]);

  // Asks the server for a certificate for a fresh Keystore key (teacher JWT,
  // public port). Replaces any previous credential of this phone.
  const enrollPhone = useCallback(
    async (token: string): Promise<PhoneCredentialStatus> => {
      if (!phoneCredentialModule) {
        throw new Error('PhoneCredentialModule is unavailable. Rebuild the Android app.');
      }
      const csr = await phoneCredentialModule.createCsr();
      const response = await fetch(`${baseUrl()}/examiner-phone/enroll`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ csr, label: phoneLabel() }),
      });
      if (!response.ok) {
        throw new Error(`Enrollment failed (HTTP ${response.status}): ${await response.text()}`);
      }
      const data: { certificate: string; mtls_port: number } = await response.json();
      return phoneCredentialModule.storeCertificate(data.certificate, data.mtls_port);
    },
    [baseUrl],
  );

  // Checks that the phone port accepts this phone's certificate for this
  // teacher (enrolled, not revoked) and, if so, enables the trusted-node
  // actions. Enrolls first if the phone has no certificate, or one about to
  // expire; a certificate the server rejects is only replaced on request
  // (Re-enroll), so a revoked phone does not silently re-enroll itself.
  const setUpPhone = useCallback(
    async (token: string, forceEnroll: boolean) => {
      if (!phoneCredentialModule) {
        setPhoneStatus('Phone credential module missing — rebuild the Android app.');
        return;
      }
      setPhoneBusy(true);
      setPhoneBaseUrl(null);
      try {
        let credential = await phoneCredentialModule.getStatus();
        if (
          forceEnroll ||
          !credential.enrolled ||
          (credential.expiresAt ?? 0) - Date.now() < RENEW_BEFORE_MS
        ) {
          setPhoneStatus('Enrolling this phone...');
          credential = await enrollPhone(token);
        }
        const url = withPort(baseUrl(), credential.mtlsPort ?? 8443);
        let response: Response;
        try {
          response = await fetch(`${url}/examiner-phone/current`, {
            headers: { Authorization: `Bearer ${token}` },
          });
        } catch {
          throw new Error(
            'The server refused this phone\'s certificate (enrolled with another server?). ' +
              'Re-enroll to get a new one.',
          );
        }
        if (!response.ok) {
          const detail = await response.text();
          throw new Error(`Phone not accepted (HTTP ${response.status}): ${detail}`);
        }
        const phone: { id: number } = await response.json();
        setPhoneBaseUrl(url);
        setPhoneStatus(`This phone is enrolled as phone-${phone.id}.`);
      } catch (err) {
        setPhoneStatus(err instanceof Error ? err.message : String(err));
      } finally {
        setPhoneBusy(false);
      }
    },
    [baseUrl, enrollPhone],
  );

  const login = useCallback(async () => {
    if (!apiBaseUrl.trim() || !email.trim() || !password) {
      Alert.alert('Incomplete', 'Please fill server URL, email and password.');
      return;
    }
    // The URL is also handed to the devices in the taps, so plain HTTP is
    // refused here rather than only by the network security config.
    if (!/^https:\/\//i.test(apiBaseUrl.trim())) {
      Alert.alert('Insecure server URL', 'The server URL must start with https://');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl.trim().replace(/\/$/, '')}/users/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Login failed (HTTP ${response.status}): ${detail}`);
      }

      const data = await response.json();
      setAccessToken(data.access_token);
      setLoggedInAs(data.email ?? email.trim());
      setStatus('Logged in. Fill in course/exam/session/device to provision.');
      await setUpPhone(data.access_token, false);
    } catch (err) {
      // fetch() reports a rejected certificate only as a network error.
      const message = err instanceof Error ? err.message : String(err);
      Alert.alert(
        'Login failed',
        message === 'Network request failed'
          ? `${message}. Check the server address, and that this deployment's CA certificate (ca.crt) is installed on the phone.`
          : message,
      );
    } finally {
      setBusy(false);
    }
  }, [apiBaseUrl, email, password, setUpPhone]);

  const logout = useCallback(() => {
    setAccessToken(null);
    setLoggedInAs(null);
    setPhoneBaseUrl(null);
    setPhoneStatus('');
    setStatus('Logged out.');
  }, []);

  // On the phone port: only an enrolled phone may register secrets.
  const provisioningSecretUrl = useCallback(
    () =>
      `${phoneBaseUrl}/course/${encodeURIComponent(courseId.trim())}` +
      `/${encodeURIComponent(examId.trim())}/${encodeURIComponent(sessionId.trim())}` +
      `/device/${encodeURIComponent(deviceId.trim())}/provisioning-secret`,
    [phoneBaseUrl, courseId, examId, sessionId, deviceId],
  );

  const registerAndActivate = useCallback(async () => {
    if (!nfcHceModule?.setSecureProvisioning || !nfcHceModule?.generateSecret) {
      Alert.alert(
        'Native module missing',
        'generateSecret/setSecureProvisioning is unavailable. Rebuild the Android app after native changes.',
      );
      return;
    }
    if (!accessToken) {
      Alert.alert('Not logged in', 'Log in first.');
      return;
    }
    if (!phoneBaseUrl) {
      Alert.alert('Phone not enrolled', phoneStatus || 'This phone is not enrolled yet.');
      return;
    }
    if (
      !courseId.trim() ||
      !examId.trim() ||
      !sessionId.trim() ||
      !deviceId.trim() ||
      !studentNmec.trim()
    ) {
      Alert.alert('Incomplete', 'Please fill course, exam, session, device IDs and student NMEC.');
      return;
    }

    setBusy(true);
    try {
      // This app is the trusted node: it generates the secret, gives it to
      // the server here, and to the device in the NFC tap.
      const secret = await nfcHceModule.generateSecret();

      const response = await fetch(provisioningSecretUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        // The examiner assigns this student to this device after checking
        // their card (pie-api-main/docs/tap-gated-student-join.md): the
        // server only lets this NMEC join the session from this device.
        body: JSON.stringify({
          secret,
          ttl_seconds: SECRET_TTL_SECONDS,
          nmec: studentNmec.trim(),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Registration failed (HTTP ${response.status}): ${detail}`);
      }

      const data: ProvisionRegistration = await response.json();

      const securePayload = JSON.stringify({
        sessionId: data.sessionId,
        nmec: studentNmec.trim(),
        apiBaseUrl: apiBaseUrl.trim().replace(/\/$/, ''),
        ttlSec: TOKEN_TTL_SECONDS,
      });

      nfcHceModule.setSecureProvisioning(securePayload, secret);
      setActive(true);
      setStatus(
        `Secure provisioning active for device ${deviceId.trim()} (session ${sessionId.trim()}, ` +
          `student ${studentNmec.trim()}). ` +
          `Arm the device's reader and tap within ${SECRET_TTL_SECONDS / 60} minutes.`,
      );
    } catch (err) {
      Alert.alert('Registration failed', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [
    accessToken,
    apiBaseUrl,
    phoneBaseUrl,
    phoneStatus,
    courseId,
    examId,
    sessionId,
    deviceId,
    studentNmec,
    provisioningSecretUrl,
  ]);

  const deactivate = useCallback(() => {
    nfcHceModule?.clearExamData?.();
    setActive(false);
    setStatus('Secure provisioning deactivated.');

    // Best-effort: drop the registered secret so it can no longer be
    // confirmed. If the tap already went through it's single-use anyway.
    if (accessToken && phoneBaseUrl) {
      fetch(provisioningSecretUrl(), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }
  }, [accessToken, phoneBaseUrl, provisioningSecretUrl]);

  const createAndHoldDeviceIdentity = useCallback(async () => {
    if (!nfcHceModule?.setPendingDeviceIdentity) {
      Alert.alert(
        'Native module missing',
        'setPendingDeviceIdentity is unavailable. Rebuild the Android app after native changes.',
      );
      return;
    }
    if (!accessToken) {
      Alert.alert('Not logged in', 'Log in first.');
      return;
    }
    if (!phoneBaseUrl) {
      Alert.alert('Phone not enrolled', phoneStatus || 'This phone is not enrolled yet.');
      return;
    }
    if (!newDeviceName.trim()) {
      Alert.alert('Incomplete', 'Please name the new device.');
      return;
    }

    setDeviceBusy(true);
    try {
      // The device gets the public URL: it never uses the phone port.
      const trimmedBaseUrl = apiBaseUrl.trim().replace(/\/$/, '');
      const response = await fetch(`${phoneBaseUrl}/device/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ name: newDeviceName.trim() }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(`Device creation failed (HTTP ${response.status}): ${detail}`);
      }

      const data: { id: number; api_key: string } = await response.json();
      const identity: DeviceIdentity = {
        deviceId: data.id,
        apiKey: data.api_key,
        apiBaseUrl: trimmedBaseUrl,
      };

      nfcHceModule.setPendingDeviceIdentity(JSON.stringify(identity));
      setPendingIdentity({ id: data.id, name: newDeviceName.trim() });
      setDeviceStatus(
        `Holding identity for device #${data.id} ("${newDeviceName.trim()}"). ` +
          'Tap the phone against the unclaimed device now — single use.',
      );
    } catch (err) {
      Alert.alert('Device creation failed', err instanceof Error ? err.message : String(err));
    } finally {
      setDeviceBusy(false);
    }
  }, [accessToken, apiBaseUrl, phoneBaseUrl, phoneStatus, newDeviceName]);

  const cancelPendingIdentity = useCallback(() => {
    nfcHceModule?.clearPendingDeviceIdentity?.();
    setPendingIdentity(null);
    setDeviceStatus('Provisioning cancelled — identity discarded, no tap will claim it now.');
  }, []);

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <Image
          source={require('./assests/PIE_Provisioner_logo_round.png')}
          style={styles.heroLogo}
          resizeMode="contain"
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>PIE API Server URL</Text>
        <TextInput
          style={styles.input}
          value={apiBaseUrl}
          onChangeText={setApiBaseUrl}
          placeholder="https://your-pie-api-host:8000"
          placeholderTextColor="#aaa"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!accessToken}
        />

        {!accessToken ? (
          <>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="teacher@example.com"
              placeholderTextColor="#aaa"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              placeholderTextColor="#aaa"
              secureTextEntry
            />

            <TouchableOpacity
              style={[styles.secondaryBtn, busy && styles.btnDisabled]}
              onPress={login}
              disabled={busy}
            >
              <Text style={styles.secondaryBtnText}>{busy ? 'Logging in...' : 'Log In'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.infoText}>Logged in as {loggedInAs}</Text>
            <View style={[styles.statusBox, phoneBaseUrl ? styles.statusOn : styles.statusOff]}>
              <Text style={styles.statusText}>{phoneBusy ? 'Checking this phone...' : phoneStatus}</Text>
            </View>
            {!phoneBaseUrl && !phoneBusy ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => accessToken && setUpPhone(accessToken, true)}
              >
                <Text style={styles.secondaryBtnText}>Re-enroll This Phone</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.secondaryBtn} onPress={logout}>
              <Text style={styles.secondaryBtnText}>Log Out</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      {accessToken ? (
        <View style={styles.card}>
          <Text style={styles.infoTitle}>Provision New Device</Text>
          <Text style={styles.infoText}>
            Mints a device identity and holds it here until you tap the phone
            against a freshly-flashed, unclaimed device — see
            device-identity-nfc-bootstrap.md.
          </Text>

          <Text style={styles.label}>Device Name</Text>
          <TextInput
            style={styles.input}
            value={newDeviceName}
            onChangeText={setNewDeviceName}
            placeholder="e.g. Sala 4.01.02 - PC03"
            placeholderTextColor="#aaa"
            editable={!pendingIdentity}
          />

          <View style={[styles.statusBox, pendingIdentity ? styles.statusOn : styles.statusOff]}>
            <Text style={styles.statusText}>{deviceStatus}</Text>
          </View>

          {pendingIdentity ? (
            <TouchableOpacity style={styles.deactivateBtn} onPress={cancelPendingIdentity}>
              <Text style={styles.deactivateBtnText}>Cancel</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.secondaryBtn, deviceBusy && styles.btnDisabled]}
              onPress={createAndHoldDeviceIdentity}
              disabled={deviceBusy}
            >
              <Text style={styles.secondaryBtnText}>
                {deviceBusy ? 'Creating...' : 'Create & Hold for Tap'}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>Course ID</Text>
        <TextInput
          style={styles.input}
          value={courseId}
          onChangeText={setCourseId}
          placeholder="e.g. SIO"
          placeholderTextColor="#aaa"
          autoCapitalize="none"
          editable={!active}
        />

        <Text style={styles.label}>Exam ID</Text>
        <TextInput
          style={styles.input}
          value={examId}
          onChangeText={setExamId}
          placeholder="e.g. 1"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
          editable={!active}
        />

        <Text style={styles.label}>Session ID</Text>
        <TextInput
          style={styles.input}
          value={sessionId}
          onChangeText={setSessionId}
          placeholder="e.g. 1"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
          editable={!active}
        />

        <Text style={styles.label}>Device ID</Text>
        <TextInput
          style={styles.input}
          value={deviceId}
          onChangeText={setDeviceId}
          placeholder="e.g. 1"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
          editable={!active}
        />

        <Text style={styles.label}>Student NMEC</Text>
        <TextInput
          style={styles.input}
          value={studentNmec}
          onChangeText={setStudentNmec}
          placeholder="e.g. 123123"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
          editable={!active}
        />
      </View>

      <View style={[styles.statusBox, active ? styles.statusOn : styles.statusOff]}>
        <Text style={styles.statusText}>{status}</Text>
      </View>

      {active ? (
        <TouchableOpacity style={styles.deactivateBtn} onPress={deactivate}>
          <Text style={styles.deactivateBtnText}>Deactivate Secure Provisioning</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[styles.activateBtn, busy && styles.btnDisabled]}
          onPress={registerAndActivate}
          disabled={busy}
        >
          <Text style={styles.activateBtnText}>
            {busy ? 'Registering...' : 'Generate Secret & Activate'}
          </Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const BRAND_SAND = '#fff5e6';
const BRAND_TAUPE = '#90887a';
const BRAND_IVORY = '#fff5e6';
const BRAND_CHARCOAL = '#4e4841';

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: BRAND_SAND,
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  hero: {
    width: '100%',
    borderRadius: 24,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 12,
    alignItems: 'center',
  },
  heroLogo: {
    width: '100%',
    maxWidth: 320,
    height: 180,
  },
  infoCard: {
    width: '100%',
    backgroundColor: '#d7cebf',
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
  },
  infoTitle: {
    color: BRAND_CHARCOAL,
    fontWeight: '700',
    marginBottom: 4,
  },
  infoText: {
    color: BRAND_CHARCOAL,
    fontSize: 12,
  },
  card: {
    width: '100%',
    backgroundColor: BRAND_IVORY,
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    elevation: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 14,
    marginBottom: 5,
  },
  input: {
    borderWidth: 1,
    borderColor: '#cec5b5',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: BRAND_CHARCOAL,
    backgroundColor: '#fffdf8',
  },
  secondaryBtn: {
    marginTop: 14,
    alignSelf: 'flex-start',
    backgroundColor: '#e0d8cb',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    color: BRAND_CHARCOAL,
    fontWeight: '600',
    fontSize: 13,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  statusBox: {
    width: '100%',
    borderRadius: 10,
    padding: 14,
    marginBottom: 20,
    alignItems: 'center',
    minHeight: 50,
    justifyContent: 'center',
  },
  statusOff: {
    backgroundColor: '#b5ad9f',
  },
  statusOn: {
    backgroundColor: '#668f52',
  },
  statusText: {
    color: BRAND_IVORY,
    fontWeight: '600',
    fontSize: 14,
    textAlign: 'center',
  },
  activateBtn: {
    backgroundColor: BRAND_TAUPE,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 52,
    elevation: 3,
  },
  activateBtnText: {
    color: BRAND_IVORY,
    fontWeight: '800',
    fontSize: 16,
  },
  deactivateBtn: {
    backgroundColor: BRAND_CHARCOAL,
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 52,
    elevation: 3,
  },
  deactivateBtnText: {
    color: BRAND_IVORY,
    fontWeight: '800',
    fontSize: 16,
  },
});

export default App;
