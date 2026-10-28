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

import React, { useCallback, useEffect, useState } from 'react';
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
// sessionId/nmec/apiBaseUrl/ttlSec/wifi from this JSON and ignores anything
// else.
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

// GET /examiner-phone/provisioning/sessions (pie-api-main): sessions not
// yet ended, to pick from instead of typing course/exam/session IDs.
interface ProvisioningSession {
  course_id: string;
  course_name?: string | null;
  exam_id: number;
  exam_name?: string | null;
  session_id: number;
  session_name?: string | null;
  room?: string | null;
  date?: string | null;
  is_started: boolean;
}

// GET /examiner-phone/provisioning/sessions/{s}/students: the session's
// allowed students, with the device each is already assigned to.
interface ProvisioningStudent {
  nmec: number;
  name?: string | null;
  email?: string | null;
  device_id?: number | null;
}

// Rows shown before the examiner types in the student search box.
const MAX_STUDENT_ROWS = 20;

function sessionTitle(s: ProvisioningSession): string {
  return [s.course_name ?? s.course_id, s.exam_name, s.session_name].filter(Boolean).join(' · ');
}

function sessionDetails(s: ProvisioningSession): string {
  return [s.room, s.date, s.is_started ? 'started' : null].filter(Boolean).join(' · ');
}

interface NativeHceModule {
  generateSecret?: () => Promise<string>;
  setSecureProvisioning?: (payloadJson: string, sharedSecretBase64Url: string) => void;
  clearProvisioning?: () => void;
  setPendingDeviceIdentity?: (identityJson: string) => void;
  clearPendingDeviceIdentity?: () => void;
}

// The exam room's wireless network, delivered in both taps so the device
// joins it (WPA2-Personal only; see examWifi() below). Matches the reader's
// apply_wifi().
interface ExamWifi {
  type: 'psk';
  ssid: string;
  psk: string;
}

// Matches ExamHceService.kt's handleGetDeviceIdentity(), which reads these
// fields and ignores anything else.
interface DeviceIdentity {
  deviceId: number;
  apiKey: string;
  apiBaseUrl: string;
  wifi?: ExamWifi;
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

  // Picking the session and the student instead of typing their IDs. The
  // manual fields stay available as a fallback.
  const [sessions, setSessions] = useState<ProvisioningSession[] | null>(null);
  const [sessionsStatus, setSessionsStatus] = useState('');
  const [selectedSession, setSelectedSession] = useState<ProvisioningSession | null>(null);
  const [manualIds, setManualIds] = useState(false);
  // null: not loaded; restricted false: the session has no allowed-students
  // list, so the NMEC is typed.
  const [students, setStudents] = useState<{
    restricted: boolean;
    students: ProvisioningStudent[];
  } | null>(null);
  const [studentFilter, setStudentFilter] = useState('');

  // The exam room's Wi-Fi, sent in every tap while set. In memory only,
  // like the server address.
  const [wifiSsid, setWifiSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');

  const [newDeviceName, setNewDeviceName] = useState('');
  const [deviceBusy, setDeviceBusy] = useState(false);
  const [pendingIdentity, setPendingIdentity] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [deviceStatus, setDeviceStatus] = useState(
    'Provisioning a new device holds its identity here until the next NFC tap.',
  );

  const baseUrl = useCallback(() => apiBaseUrl.trim().replace(/\/$/, ''), [apiBaseUrl]);

  // The network for the taps, or undefined to leave the device's network as
  // it is. Throws on values the device would reject anyway.
  const examWifi = useCallback((): ExamWifi | undefined => {
    const ssid = wifiSsid.trim();
    if (!ssid) {
      return undefined;
    }
    // UTF-8 length: each %XX escape is one byte.
    if (encodeURIComponent(ssid).replace(/%[0-9A-F]{2}/gi, 'x').length > 32) {
      throw new Error('The Wi-Fi name (SSID) is longer than 32 bytes.');
    }
    if (wifiPassword.length < 8 || wifiPassword.length > 63) {
      throw new Error('The Wi-Fi password must have 8 to 63 characters.');
    }
    return { type: 'psk', ssid, psk: wifiPassword };
  }, [wifiSsid, wifiPassword]);

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
      setStatus('Logged in. Pick the session, then the device and student to provision.');
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

  const loadSessions = useCallback(async () => {
    if (!accessToken || !phoneBaseUrl) {
      return;
    }
    setSessionsStatus('Loading sessions...');
    try {
      const response = await fetch(`${phoneBaseUrl}/examiner-phone/provisioning/sessions`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
      const data: ProvisioningSession[] = await response.json();
      setSessions(data);
      setSessionsStatus(data.length ? '' : 'No open sessions. Create one in the dashboard.');
    } catch (err) {
      setSessions(null);
      setSessionsStatus(`Could not load sessions: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [accessToken, phoneBaseUrl]);

  const loadStudents = useCallback(
    async (session: ProvisioningSession) => {
      if (!accessToken || !phoneBaseUrl) {
        return;
      }
      try {
        const response = await fetch(
          `${phoneBaseUrl}/examiner-phone/provisioning/sessions/${session.session_id}/students`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }
        setStudents(await response.json());
      } catch {
        // Fall back to typing the NMEC; the server still checks it.
        setStudents({ restricted: false, students: [] });
      }
    },
    [accessToken, phoneBaseUrl],
  );

  // Once the phone is accepted, offer the open sessions.
  useEffect(() => {
    if (phoneBaseUrl && accessToken) {
      loadSessions();
    } else {
      setSessions(null);
      setSelectedSession(null);
      setStudents(null);
    }
  }, [phoneBaseUrl, accessToken, loadSessions]);

  const pickSession = useCallback(
    (session: ProvisioningSession) => {
      setSelectedSession(session);
      setCourseId(session.course_id);
      setExamId(String(session.exam_id));
      setSessionId(String(session.session_id));
      setStudentNmec('');
      setStudentFilter('');
      setStudents(null);
      loadStudents(session);
    },
    [loadStudents],
  );

  // Back to the list: the IDs come from the next pick (or manual entry).
  const changeSession = useCallback(() => {
    setSelectedSession(null);
    setCourseId('');
    setExamId('');
    setSessionId('');
    setStudents(null);
    setStudentNmec('');
    setStudentFilter('');
    loadSessions();
  }, [loadSessions]);

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
    // Before registering anything with the server.
    let wifi: ExamWifi | undefined;
    try {
      wifi = examWifi();
    } catch (err) {
      Alert.alert('Wi-Fi', err instanceof Error ? err.message : String(err));
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
        wifi,
      });

      nfcHceModule.setSecureProvisioning(securePayload, secret);
      setActive(true);
      setStatus(
        `Secure provisioning active for device ${deviceId.trim()} (session ${sessionId.trim()}, ` +
          `student ${studentNmec.trim()}). ` +
          `Tap the device within ${SECRET_TTL_SECONDS / 60} minutes.`,
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
    examWifi,
  ]);

  const deactivate = useCallback(() => {
    nfcHceModule?.clearProvisioning?.();
    setActive(false);
    setStatus('Secure provisioning deactivated.');

    // Best-effort: drop the registered secret so it can no longer be
    // confirmed. If the tap already went through it's single-use anyway.
    const deleted =
      accessToken && phoneBaseUrl
        ? fetch(provisioningSecretUrl(), {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
          }).catch(() => {})
        : Promise.resolve();

    // Ready for the next seat; the refreshed list shows this assignment.
    setDeviceId('');
    setStudentNmec('');
    setStudentFilter('');
    if (selectedSession) {
      deleted.then(() => loadStudents(selectedSession));
    }
  }, [accessToken, phoneBaseUrl, provisioningSecretUrl, selectedSession, loadStudents]);

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

    let wifi: ExamWifi | undefined;
    try {
      wifi = examWifi();
    } catch (err) {
      Alert.alert('Wi-Fi', err instanceof Error ? err.message : String(err));
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
        wifi,
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
  }, [accessToken, apiBaseUrl, phoneBaseUrl, phoneStatus, newDeviceName, examWifi]);

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
          <Text style={styles.infoTitle}>Exam Room Wi-Fi</Text>
          <Text style={styles.infoText}>
            Sent in every tap while set: the device joins this network before
            it contacts the server. Leave it empty to keep the device's
            current network. WPA2-Personal only.
          </Text>

          <Text style={styles.label}>Network Name (SSID)</Text>
          <TextInput
            style={styles.input}
            value={wifiSsid}
            onChangeText={setWifiSsid}
            placeholder="e.g. PIE-Exams"
            placeholderTextColor="#aaa"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!active && !pendingIdentity}
          />

          <Text style={styles.label}>Password</Text>
          <TextInput
            style={styles.input}
            value={wifiPassword}
            onChangeText={setWifiPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            editable={!active && !pendingIdentity}
          />
        </View>
      ) : null}

      {accessToken ? (
        <View style={styles.card}>
          <Text style={styles.infoTitle}>Provision New Device</Text>
          <Text style={styles.infoText}>
            Creates a device identity and holds it here until you tap the
            phone on a new, unregistered device.
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
        <Text style={styles.infoTitle}>Session</Text>
        {manualIds ? (
          <>
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
            {!active ? (
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  setManualIds(false);
                  changeSession();
                }}
              >
                <Text style={styles.secondaryBtnText}>Pick From List</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : selectedSession ? (
          <>
            <View style={[styles.pickRow, styles.pickRowSelected]}>
              <Text style={styles.pickTitle}>{sessionTitle(selectedSession)}</Text>
              <Text style={styles.pickDetails}>{sessionDetails(selectedSession)}</Text>
            </View>
            {!active ? (
              <TouchableOpacity style={styles.secondaryBtn} onPress={changeSession}>
                <Text style={styles.secondaryBtnText}>Change Session</Text>
              </TouchableOpacity>
            ) : null}
          </>
        ) : (
          <>
            {!phoneBaseUrl ? (
              <Text style={styles.infoText}>Log in on an enrolled phone to list the sessions.</Text>
            ) : null}
            {sessionsStatus ? <Text style={styles.infoText}>{sessionsStatus}</Text> : null}
            {(sessions ?? []).map(session => (
              <TouchableOpacity
                key={session.session_id}
                style={styles.pickRow}
                onPress={() => pickSession(session)}
              >
                <Text style={styles.pickTitle}>{sessionTitle(session)}</Text>
                <Text style={styles.pickDetails}>{sessionDetails(session)}</Text>
              </TouchableOpacity>
            ))}
            {phoneBaseUrl ? (
              <TouchableOpacity style={styles.secondaryBtn} onPress={loadSessions}>
                <Text style={styles.secondaryBtnText}>Refresh</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setManualIds(true)}>
              <Text style={styles.secondaryBtnText}>Enter IDs Manually</Text>
            </TouchableOpacity>
          </>
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.infoTitle}>Seat</Text>
        <Text style={styles.label}>Device ID (on the device's label)</Text>
        <TextInput
          style={styles.input}
          value={deviceId}
          onChangeText={setDeviceId}
          placeholder="e.g. 10"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
          editable={!active}
        />

        <Text style={styles.label}>Student</Text>
        {!manualIds && students?.restricted ? (
          (() => {
            const picked = students.students.find(st => String(st.nmec) === studentNmec);
            if (picked) {
              return (
                <>
                  <View style={[styles.pickRow, styles.pickRowSelected]}>
                    <Text style={styles.pickTitle}>{picked.name ?? picked.email}</Text>
                    <Text style={styles.pickDetails}>NMEC {picked.nmec}</Text>
                  </View>
                  {!active ? (
                    <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStudentNmec('')}>
                      <Text style={styles.secondaryBtnText}>Change Student</Text>
                    </TouchableOpacity>
                  ) : null}
                </>
              );
            }
            const query = studentFilter.trim().toLowerCase();
            const matches = students.students.filter(
              st =>
                !query ||
                String(st.nmec).includes(query) ||
                (st.name ?? '').toLowerCase().includes(query) ||
                (st.email ?? '').toLowerCase().includes(query),
            );
            return (
              <>
                <TextInput
                  style={styles.input}
                  value={studentFilter}
                  onChangeText={setStudentFilter}
                  placeholder="Search name, NMEC or email"
                  placeholderTextColor="#aaa"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!active}
                />
                {matches.slice(0, MAX_STUDENT_ROWS).map(st => (
                  <TouchableOpacity
                    key={st.nmec}
                    style={styles.pickRow}
                    onPress={() => setStudentNmec(String(st.nmec))}
                    disabled={active}
                  >
                    <Text style={styles.pickTitle}>{st.name ?? st.email}</Text>
                    <Text style={styles.pickDetails}>
                      NMEC {st.nmec}
                      {st.device_id != null ? ` · assigned to device ${st.device_id}` : ''}
                    </Text>
                  </TouchableOpacity>
                ))}
                {matches.length > MAX_STUDENT_ROWS ? (
                  <Text style={styles.infoText}>
                    {matches.length - MAX_STUDENT_ROWS} more; type to narrow the list.
                  </Text>
                ) : null}
                {matches.length === 0 ? (
                  <Text style={styles.infoText}>No allowed student matches.</Text>
                ) : null}
              </>
            );
          })()
        ) : (
          <TextInput
            style={styles.input}
            value={studentNmec}
            onChangeText={setStudentNmec}
            placeholder="Student NMEC, e.g. 123123"
            placeholderTextColor="#aaa"
            keyboardType="numeric"
            editable={!active}
          />
        )}
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
  pickRow: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#cec5b5',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#fffdf8',
  },
  pickRowSelected: {
    borderColor: '#668f52',
    borderWidth: 2,
  },
  pickTitle: {
    color: BRAND_CHARCOAL,
    fontWeight: '600',
    fontSize: 14,
  },
  pickDetails: {
    color: BRAND_TAUPE,
    fontSize: 12,
    marginTop: 2,
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
