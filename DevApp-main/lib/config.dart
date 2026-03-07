import 'dart:convert';
import 'dart:io';

class Config {
  final int _deviceId;
  final String _apiBaseUrl;
  final String _examDirectory;
  final String _logsDirectory;
  final String _whitelistFile;

  final Map<String, dynamic> _configMap = {};

  static Config? _instance;

  Config._({
    required int deviceId,
    required String apiBaseUrl,
    required String examDirectory,
    required String logsDirectory,
    required String whitelistFile,
  })  : _deviceId = deviceId,
        _apiBaseUrl = apiBaseUrl,
        _examDirectory = examDirectory,
        _logsDirectory = logsDirectory,
        _whitelistFile = whitelistFile;

  factory Config._fromJson(Map<String, dynamic> json) {
    return Config._(
      deviceId: json['deviceId'],
      apiBaseUrl: json['apiBaseUrl'],
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
    return _instance!._deviceId;
  }

  static String get apiBaseUrl {
    if (_instance == null) {
      throw Exception('Config not loaded. Call Config.load() first.');
    }
    return _instance!._apiBaseUrl;
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
