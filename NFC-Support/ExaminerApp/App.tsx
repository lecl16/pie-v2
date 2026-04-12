/**
 * @format
 */

import React, { useCallback, useState } from 'react';
import {
  Alert,
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

if (!NfcHceModule) {
  console.error(
    '[ExaminerApp] NfcHceModule not found. ' +
    'Make sure you ran a full native rebuild (npm run android) after adding the module.',
  );
}

interface ExamPayload {
  ip: string;
  sessionId: string;
  nmec: string;
  timestamp: string;
}

interface NativeHceModule {
  setExamData?: (jsonPayload: string) => void;
  clearExamData?: () => void;
}

const nfcHceModule = NfcHceModule as NativeHceModule | undefined;

// ---- Root -------------------------------------------------------------------

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
    </SafeAreaProvider>
  );
}

// ---- Main Content ------------------------------------------------------------

function AppContent(): React.JSX.Element {
  const insets = useSafeAreaInsets();

  const [hceActive, setHceActive] = useState(false);
  const [status, setStatus] = useState('Fill all fields and tap Activate NFC Sender.');

  const [payload, setPayload] = useState<ExamPayload>({
    ip: '192.168.1.10',
    sessionId: 'S2026-001',
    nmec: '12345',
    timestamp: new Date().toISOString(),
  });

  const updateField = useCallback(
    (field: keyof ExamPayload) => (value: string) =>
      setPayload(p => ({ ...p, [field]: value })),
    [],
  );

  const setNowTimestamp = useCallback(() => {
    setPayload(p => ({ ...p, timestamp: new Date().toISOString() }));
  }, []);

  const activate = useCallback(() => {
    if (
      !payload.ip.trim() ||
      !payload.sessionId.trim() ||
      !payload.nmec.trim() ||
      !payload.timestamp.trim()
    ) {
      Alert.alert('Incomplete', 'Please fill IP, Session ID, Student ID and Timestamp.');
      return;
    }

    const jsonPayload = JSON.stringify({
      ip: payload.ip.trim(),
      sessionId: payload.sessionId.trim(),
      nmec: payload.nmec.trim(),
      timestamp: payload.timestamp.trim(),
    });

    if (jsonPayload.length > 240) {
      Alert.alert(
        'Payload too large',
        `Payload JSON is ${jsonPayload.length} bytes. Keep it compact for APDU transfer.`,
      );
      return;
    }

    nfcHceModule?.setExamData?.(jsonPayload);
    setHceActive(true);
    setStatus('NFC sender active. Tap the phone to PN532 and request exam data (INS CA).');
  }, [payload]);

  const deactivate = useCallback(() => {
    nfcHceModule?.clearExamData?.();
    setHceActive(false);
    setStatus('NFC sender deactivated.');
  }, []);

  return (
    <ScrollView
      contentContainerStyle={[styles.container, { paddingTop: insets.top + 16 }]}
      keyboardShouldPersistTaps="handled">

      <Text style={styles.title}>PIE Provisioner</Text>
      <Text style={styles.subtitle}>NFC Sender for PN532</Text>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>APDU Commands</Text>
        <Text style={styles.infoText}>SELECT AID: INS A4</Text>
        <Text style={styles.infoText}>GET EXAM DATA: INS CA</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>Exam Server IP Address</Text>
        <TextInput
          style={styles.input}
          value={payload.ip}
          onChangeText={updateField('ip')}
          placeholder="e.g. 192.168.1.10"
          placeholderTextColor="#aaa"
          editable={!hceActive}
        />

        <Text style={styles.label}>Session ID</Text>
        <TextInput
          style={styles.input}
          value={payload.sessionId}
          onChangeText={updateField('sessionId')}
          placeholder="e.g. S2026-001"
          placeholderTextColor="#aaa"
          editable={!hceActive}
        />

        <Text style={styles.label}>Student ID (NMec)</Text>
        <TextInput
          style={styles.input}
          value={payload.nmec}
          onChangeText={updateField('nmec')}
          placeholder="e.g. 12345"
          placeholderTextColor="#aaa"
          keyboardType="numeric"
          editable={!hceActive}
        />

        <Text style={styles.label}>Timestamp</Text>
        <TextInput
          style={styles.input}
          value={payload.timestamp}
          onChangeText={updateField('timestamp')}
          placeholder="e.g. 2026-04-06T14:20:00.000Z"
          placeholderTextColor="#aaa"
          editable={!hceActive}
        />

        {!hceActive ? (
          <TouchableOpacity style={styles.secondaryBtn} onPress={setNowTimestamp}>
            <Text style={styles.secondaryBtnText}>Use Current Time</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={[styles.statusBox, hceActive ? styles.statusOn : styles.statusOff]}>
        <Text style={styles.statusText}>{status}</Text>
      </View>

      {hceActive ? (
        <TouchableOpacity style={styles.deactivateBtn} onPress={deactivate}>
          <Text style={styles.deactivateBtnText}>Deactivate NFC Sender</Text>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity style={styles.activateBtn} onPress={activate}>
          <Text style={styles.activateBtnText}>Activate NFC Sender</Text>
        </TouchableOpacity>
      )}

    </ScrollView>
  );
}

// ---- Styles -----------------------------------------------------------------

const ACCENT = '#e63946';

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    backgroundColor: ACCENT,
    paddingHorizontal: 20,
    paddingBottom: 48,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 15,
    color: 'rgba(255,255,255,0.8)',
    marginBottom: 12,
  },
  infoCard: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  infoTitle: {
    color: '#fff',
    fontWeight: '700',
    marginBottom: 4,
  },
  infoText: {
    color: '#fff',
    fontSize: 12,
  },
  card: {
    width: '100%',
    backgroundColor: '#fff',
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
    borderColor: '#e0e0e0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
    color: '#222',
    backgroundColor: '#fafafa',
  },
  secondaryBtn: {
    marginTop: 14,
    alignSelf: 'flex-start',
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    color: '#333',
    fontWeight: '600',
    fontSize: 13,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  flex1: {
    flex: 1,
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
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  statusOn: {
    backgroundColor: '#2dc653',
  },
  statusText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
    textAlign: 'center',
  },
  activateBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 52,
    elevation: 3,
  },
  activateBtnText: {
    color: ACCENT,
    fontWeight: 'bold',
    fontSize: 16,
  },
  deactivateBtn: {
    backgroundColor: '#1d1d1d',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 52,
    elevation: 3,
  },
  deactivateBtnText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default App;
