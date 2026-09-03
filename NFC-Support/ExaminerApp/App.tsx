/**
 * @format
 *
 * Secure provisioning app flow:
 * 1) Examiner fills payload + shared secret.
 * 2) App enables HCE secure mode.
 * 3) Reader sends challenge APDU and then requests signed token APDU.
 */

import React, { useCallback, useState } from 'react';
import {
  Alert,
  Image,
  NativeModules,
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

const { NfcHceModule } = NativeModules;

interface ProvisionPayload {
  ip: string;
  sessionId: string;
  nmec: string;
  timestamp: string;
  ttlSec: string;
}

interface NativeHceModule {
  setSecureProvisioning?: (payloadJson: string, sharedSecretBase64Url: string) => void;
  clearExamData?: () => void;
}

const nfcHceModule = NfcHceModule as NativeHceModule | undefined;

function isBase64Url(input: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(input);
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
  const [status, setStatus] = useState('Fill fields and activate secure provisioning.');
  // TODO(server-integration): Replace manual secret entry with a fetch from backend.
  // The expected flow is: reader uploads secret to server, app retrieves it for this exam/session.
  const [sharedSecretB64u, setSharedSecretB64u] = useState('');

  const [payload, setPayload] = useState<ProvisionPayload>({
    ip: '192.168.1.10',
    sessionId: 'S2026-001',
    nmec: '12345',
    timestamp: new Date().toISOString(),
    ttlSec: '60',
  });

  const updateField = useCallback(
    (field: keyof ProvisionPayload) => (value: string) =>
      setPayload(prev => ({ ...prev, [field]: value })),
    [],
  );

  const setNowTimestamp = useCallback(() => {
    setPayload(prev => ({ ...prev, timestamp: new Date().toISOString() }));
  }, []);

  const activate = useCallback(() => {
    if (!nfcHceModule?.setSecureProvisioning) {
      Alert.alert(
        'Native module missing',
        'setSecureProvisioning is unavailable. Rebuild the Android app after native changes.',
      );
      return;
    }

    if (
      !payload.ip.trim() ||
      !payload.sessionId.trim() ||
      !payload.nmec.trim() ||
      !payload.timestamp.trim() ||
      !payload.ttlSec.trim()
    ) {
      Alert.alert('Incomplete', 'Please fill all provisioning fields.');
      return;
    }

    const ttlParsed = Number(payload.ttlSec);
    if (!Number.isFinite(ttlParsed) || ttlParsed < 10 || ttlParsed > 600) {
      Alert.alert('Invalid TTL', 'TTL must be a number between 10 and 600 seconds.');
      return;
    }

    const secret = sharedSecretB64u.trim();
    if (!secret || !isBase64Url(secret)) {
      Alert.alert('Invalid secret', 'Shared secret must be Base64URL (no spaces, no =).');
      return;
    }

    const securePayload = JSON.stringify({
      ip: payload.ip.trim(),
      sessionId: payload.sessionId.trim(),
      nmec: payload.nmec.trim(),
      timestamp: payload.timestamp.trim(),
      ttlSec: ttlParsed,
    });

    nfcHceModule.setSecureProvisioning(securePayload, secret);
    setActive(true);
    setStatus('Secure provisioning active. Reader must send INS CB (challenge), then INS CC (token).');
  }, [payload, sharedSecretB64u]);

  const deactivate = useCallback(() => {
    nfcHceModule?.clearExamData?.();
    setActive(false);
    setStatus('Secure provisioning deactivated.');
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

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Secure APDU Commands</Text>
        <Text style={styles.infoText}>SELECT AID: INS A4</Text>
        <Text style={styles.infoText}>SET READER CHALLENGE: INS CB</Text>
        <Text style={styles.infoText}>GET PROVISION TOKEN: INS CC</Text>
        <Text style={styles.infoText}>TODO: read shared secret from server (temporary manual paste for now).</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Shared Secret (Base64URL)</Text>
        <TextInput
          style={styles.input}
          value={sharedSecretB64u}
          onChangeText={setSharedSecretB64u}
          placeholder="Temporary: paste secret shown by reader_script.py"
          placeholderTextColor="#aaa"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!active}
        />

        <Text style={styles.label}>Exam Server IP Address</Text>
        <TextInput
          style={styles.input}
          value={payload.ip}
          onChangeText={updateField('ip')}
          placeholder="e.g. 192.168.1.10"
          placeholderTextColor="#aaa"
          editable={!active}
        />

        <Text style={styles.label}>Session ID</Text>
        <TextInput
          style={styles.input}
          value={payload.sessionId}
          onChangeText={updateField('sessionId')}
          placeholder="e.g. S2026-001"
          placeholderTextColor="#aaa"
          editable={!active}
        />

        <Text style={styles.label}>Student ID (NMec)</Text>
        <TextInput
          style={styles.input}
          value={payload.nmec}
          onChangeText={updateField('nmec')}
          placeholder="e.g. 12345"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
          editable={!active}
        />

        <Text style={styles.label}>Timestamp</Text>
        <TextInput
          style={styles.input}
          value={payload.timestamp}
          onChangeText={updateField('timestamp')}
          placeholder="e.g. 2026-04-06T14:20:00.000Z"
          placeholderTextColor="#aaa"
          editable={!active}
        />

        <Text style={styles.label}>Token TTL (Seconds)</Text>
        <TextInput
          style={styles.input}
          value={payload.ttlSec}
          onChangeText={updateField('ttlSec')}
          placeholder="e.g. 60"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
          editable={!active}
        />

        {!active ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={setNowTimestamp}>
            <Text style={styles.secondaryBtnText}>Use Current Time</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={[styles.statusBox, active ? styles.statusOn : styles.statusOff]}>
        <Text style={styles.statusText}>{status}</Text>
      </View>

      {active ? (
        <TouchableOpacity style={styles.deactivateBtn} onPress={deactivate}>
          <Text style={styles.deactivateBtnText}>Deactivate Secure Provisioning</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.activateBtn} onPress={activate}>
          <Text style={styles.activateBtnText}>Activate Secure Provisioning</Text>
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
