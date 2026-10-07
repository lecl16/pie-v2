import 'dart:convert';
import 'dart:io';

import 'package:http/http.dart' as http;

class Config {
  // This device (an x86 host booted live from the amd64 image the attached
  // Pi serves over USB — see device-build/README.md's "Architecture"
  // section) never has a durable local `deviceId`: its own root filesystem
  // is a `boot=live` RAM overlay with no persistence configured, wiped on
  // every reboot, so there's nothing to read a `deviceId` back out of even
  // if one had ever been written here. Instead it's fetched fresh from the
  // Pi on every boot (see fetchDeviceIdentity()) and only ever held in memory.
  int? _deviceId;
  // Same for the API server address: the image deliberately carries none
  // (pie-api-main/docs/examiner-trusted-node-provisioning.md) — the examiner
  // app delivers it to the Pi over NFC and the Pi relays it here.
  String? _apiBaseUrl;
  // The session the Pi was provisioned for by the examiner's last confirmed
  // NFC tap, the student the examiner assigned to this device, and the key
  // derived from the session secret that proves a join comes from this
  // device (pie-api-main/docs/tap-gated-student-join.md). In memory only,
  // like the fields above.
  int? _provisionedSessionId;
  String? _provisionedNmec;
  String? _joinKey;
  final String _piIdentityUrl;
  final String _examDirectory;
  final String _logsDirectory;
  final String _whitelistFile;

  final Map<String, dynamic> _configMap = {};

  static Config? _instance;

  Config._({
    required String piIdentityUrl,
    required String examDirectory,
    required String logsDirectory,
    required String whitelistFile,
  })  : _piIdentityUrl = piIdentityUrl,
        _examDirectory = examDirectory,
        _logsDirectory = logsDirectory,
        _whitelistFile = whitelistFile;

  factory Config._fromJson(Map<String, dynamic> json) {
    return Config._(
      piIdentityUrl: json['piIdentityUrl'],
      examDirectory: json['examDirectory'],
      logsDirectory: json['logsDirectory'],
      whitelistFile: json['whitelistFile'],
    );
  }

  static Future<Config> load() async {
    if (_instance != null) {
      return _instance!;
    }

    final file = File('/etc/pie-devapp/config.json');
    final contents = await file.readAsString();
    final json = jsonDecode(contents);
    _instance = Config._fromJson(json);
    return _instance!;
  }

  static void addToConfigMap(String key, dynamic value) {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    if (_instance!._configMap.containsKey(key)) {
      throw Exception('Key already exists in config map: $key');
    }
    _instance!._configMap[key] = value;
  }

  static dynamic getFromConfigMap(String key) {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    if (!_instance!._configMap.containsKey(key)) {
      return null;
    }
    return _instance!._configMap[key];
  }

  static Config get instance {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    return _instance!;
  }

  static int get deviceId {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    final id = _instance!._deviceId;
    if (id == null) {
      throw Exception(
        'Device not yet provisioned: no deviceId fetched from the Pi yet. '
        'Check Config.isProvisioned before reading Config.deviceId.',
      );
    }
    return id;
  }

  /// True once this device has a `deviceId` and `apiBaseUrl` in memory —
  /// i.e. the attached Pi has already been claimed via the NFC
  /// identity-bootstrap tap and reported both back over `piIdentityUrl`.
  /// False before the first successful fetchDeviceIdentity() call each boot.
  static bool get isProvisioned {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    return _instance!._deviceId != null && _instance!._apiBaseUrl != null;
  }

  /// Asks the attached Pi's device_identity_server.py for this device's
  /// `deviceId` and the API server's `apiBaseUrl`, over `piIdentityUrl` (the
  /// usb0 link — see device-build/README.md's "Architecture" section for why
  /// this can't just be a local file read: this app's own root is wiped
  /// every reboot, the Pi is the only side that actually persists them).
  /// Picks up an NFC claim that lands while this app is already running and
  /// showing the "device not yet provisioned" screen (see main.dart). Also
  /// called periodically after that: a session tap can move the Pi to a new
  /// server address (e.g. the examiner's laptop got a different IP in
  /// another room), and this is how that reaches the app.
  static Future<void> fetchDeviceIdentity() async {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    try {
      final response = await http
          .get(Uri.parse('${_instance!._piIdentityUrl}/device-identity'))
          .timeout(const Duration(seconds: 3));
      if (response.statusCode != 200) {
        return; // Most commonly 404 "unclaimed" — not an error, just not yet.
      }
      final json = jsonDecode(response.body);
      final id = json['deviceId'];
      final url = json['apiBaseUrl'];
      if (id is int && url is String && url.isNotEmpty) {
        _instance!._deviceId = id;
        _instance!._apiBaseUrl = url.endsWith('/') ? url.substring(0, url.length - 1) : url;
      }
    } catch (_) {
      // Pi unreachable, still booting its own services, or not yet claimed
      // — keep whatever we had and let the next poll try again.
    }
  }

  /// True once the examiner has tapped this device for a session and the
  /// Pi confirmed it with the server (see fetchProvisionedSession()).
  static bool get isSessionProvisioned {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    return _instance!._provisionedSessionId != null &&
        _instance!._provisionedNmec != null &&
        _instance!._joinKey != null;
  }

  static int? get provisionedSessionId => _instance?._provisionedSessionId;

  static String? get provisionedNmec => _instance?._provisionedNmec;

  static String? get joinKey => _instance?._joinKey;

  /// Asks the Pi's device_identity_server.py for the session it was
  /// provisioned for (`GET /session`). A 404 means no confirmed session tap
  /// yet, so any previously fetched session is dropped; a network error
  /// keeps it. Polled periodically, so an examiner re-registering the device
  /// for a different student reaches the app too.
  static Future<void> fetchProvisionedSession() async {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    try {
      final response = await http
          .get(Uri.parse('${_instance!._piIdentityUrl}/session'))
          .timeout(const Duration(seconds: 3));
      if (response.statusCode == 404) {
        _instance!._provisionedSessionId = null;
        _instance!._provisionedNmec = null;
        _instance!._joinKey = null;
        return;
      }
      if (response.statusCode != 200) {
        return;
      }
      final json = jsonDecode(response.body);
      final sessionId = json['sessionId'];
      final nmec = json['nmec'];
      final joinKey = json['joinKey'];
      if (sessionId is int && nmec is String && joinKey is String && joinKey.isNotEmpty) {
        _instance!._provisionedSessionId = sessionId;
        _instance!._provisionedNmec = nmec;
        _instance!._joinKey = joinKey;
      }
    } catch (_) {
      // Pi unreachable — keep whatever we had and let the next poll try again.
    }
  }

  static String get apiBaseUrl {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    final url = _instance!._apiBaseUrl;
    if (url == null) {
      throw Exception(
        'Device not yet provisioned: no apiBaseUrl fetched from the Pi yet. '
        'Check Config.isProvisioned before reading Config.apiBaseUrl.',
      );
    }
    return url;
  }

  static String get examDirectory {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    return _instance!._examDirectory;
  }

  static String get logsDirectory {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    return _instance!._logsDirectory;
  }

  static String get whitelistFile {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    return _instance!._whitelistFile;
  }

  static bool get isDataSet {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    return _instance!._configMap.containsKey('token') &&
        _instance!._configMap.containsKey('nmec') &&
        _instance!._configMap.containsKey('courseID') &&
        _instance!._configMap.containsKey('examID') &&
        _instance!._configMap.containsKey('sessionID') &&
        _instance!._configMap.containsKey('sessionUserID');
  }
}
