import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:devapp/config.dart';
import 'package:http/http.dart' as http;

enum LogLevel {
  debug,
  info,
  warning,
  error,
}

enum LogCategory {
  network,
  system,
  usb,
  bluetooth,
  command,
  file,
}

class Log {
  final DateTime timestamp;
  final int deviceId;
  final String courseId;
  final int examId;
  final LogLevel level;
  final LogCategory category;
  final String message;
  final Map<String, dynamic> details;

  Log({
    required this.level,
    required this.category,
    required this.message,
    this.details = const {},
  })  : timestamp = DateTime.now(),
        deviceId = Config.deviceId,
        courseId = Config.getFromConfigMap('courseID') ?? Null,
        examId = Config.getFromConfigMap('examID') ?? Null;

  Map<String, dynamic> toJson() {
    return {
      "timestamp": timestamp.toIso8601String(),
      "device_id": deviceId,
      "course_id": courseId,
      "exam_id": examId,
      "level": level.name.toUpperCase(),
      "category": category.name.toUpperCase(),
      "message": message,
      "details": details,
    };
  }
}

class Logger {
  static late final String _logFilePath;

  static final Map<String, Map<String, String>> deviceCache = {};

  static Future<void> init() async {
    final path = '${Config.logsDirectory}/devapp_${DateTime.now().toIso8601String()}.log';
    try {
      final logFile = File(path);
      if (!await logFile.exists()) {
        await logFile.create(recursive: true);
      }
      _logFilePath = logFile.path;
    } catch (e) {
      print('Error creating log file: $e');
      _logFilePath = '';
    }
  }

  static Future<void> startBashListener() async {
    final logFile = File('${Config.logsDirectory}/bash.log');

    if (!await logFile.exists()) {
      print("rsyslog logging file could not be found!");
      return;
    }

    var lastPos = await logFile.length();

    Timer.periodic(Duration(milliseconds: 500), (_) async {
      final currentPos = await logFile.length();

      if (currentPos > lastPos) {
        final stream = logFile.openRead(lastPos, currentPos)
            .transform(utf8.decoder)
            .transform(const LineSplitter());

        await for (var line in stream) {
          final regex = RegExp(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[+-]\d{2}:\d{2}))\s+(\S+)\s+(\S+):\s+(\S+)\s+\[(\d+)\]:\s+(.*)$');

          final match = regex.firstMatch(line);
          if (match != null) {
            final timestamp = match.group(1);
            final hostname = match.group(2);
            // final serviceTag = match.group(3);
            final username = match.group(4);
            final pid = match.group(5);
            final command = match.group(6);

            print('[$timestamp] $username@$hostname ran: $command (PID: $pid)');
            Log log = Log(
              level: LogLevel.info,
              category: LogCategory.command,
              message: "User command executed",
              details: {
                'timestamp': timestamp,
                'username': username,
                'hostname': hostname,
                'pid': pid,
                'command': command,
              },
            );

            Logger.post(log).then((response) {
              if (response.statusCode == 200) {
                print('Log enviado com sucesso: ${response.body}');
              } else {
                print('Erro ao enviar log: ${response.statusCode} - ${response.body}');
              }
            }).catchError((error) {
              print('Erro ao enviar log: $error');
            });
          } else {
            print("Unrecognized line: $line");
          }
        }

        lastPos = currentPos;
      }
    });
  }

  static Future<Map<String, String>?> _getDeviceInfo(String devPath) async {
    final result = await Process.run(
      'udevadm',
      ['info', '--query=property', '--path=$devPath'],
      runInShell: true,
    );

    if (result.exitCode != 0) return null;

    final info = <String, String>{};
    for (var line in LineSplitter.split(result.stdout)) {
      final parts = line.split('=');
      if (parts.length == 2) {
        info[parts[0]] = parts[1];
      }
    }

    if (!info.containsKey('ID_VENDOR_ID') || !info.containsKey('ID_MODEL_ID')) {
      return null;
    }

    return {
      'bus': info['BUSNUM'] ?? '',
      'device_num': info['DEVNUM'] ?? '',
      'vendor_id': info['ID_VENDOR_ID'] ?? '',
      'product_id': info['ID_MODEL_ID'] ?? '',
      'manufacturer': info['ID_VENDOR_FROM_DATABASE'] ?? info['ID_VENDOR'] ?? '',
      'product': info['ID_MODEL_FROM_DATABASE'] ?? info['ID_MODEL'] ?? '',
      'description': info['ID_USB_DRIVER'] ?? '',
    };
  }

  static Future<void> sendInitializationLog() async {
    final List<Map<String, dynamic>> usbDevices = [];

    final lsusbResult = await Process.run('lsusb', []);
    if (lsusbResult.exitCode != 0) {
      throw Exception('Failed to run lsusb: ${lsusbResult.stderr}');
    }

    final lsusbLines = (lsusbResult.stdout as String).split('\n');

    for (final line in lsusbLines) {
      if (line.trim().isEmpty) continue;

      final device = <String, dynamic>{};
      final deviceInfoForCache = <String, String>{};

      final regex = RegExp(r'Bus (\d+) Device (\d+): ID ([0-9a-f]{4}):([0-9a-f]{4}) (.+)');
      final match = regex.firstMatch(line);
      if (match == null) continue;

      final bus = match.group(1);
      final deviceNum = match.group(2);
      final vendorId = match.group(3);
      final productId = match.group(4);
      final desc = match.group(5) ?? '';

      device['bus'] = bus;
      device['device_num'] = deviceNum;
      device['vendor_id'] = vendorId;
      device['product_id'] = productId;
      device['description'] = desc;

      final devicePath = '/dev/bus/usb/$bus/${deviceNum!.padLeft(3, '0')}';

      final udevadmResult = await Process.run('udevadm', ['info', '--query=all', '--name=$devicePath']);
      if (udevadmResult.exitCode == 0) {
        final udevOutput = udevadmResult.stdout as String;
        final getValue = (String key) {
          final match = RegExp(r'E: ' + key + r'=(.+)').firstMatch(udevOutput);
          return match?.group(1);
        };

        final manufacturer = getValue('ID_VENDOR_FROM_DATABASE') ?? getValue('ID_VENDOR') ?? '';
        final product = getValue('ID_MODEL_FROM_DATABASE') ?? getValue('ID_MODEL') ?? '';

        device['manufacturer'] = manufacturer;
        device['product'] = product;

        final udevDevPathMatch = RegExp(r'E: DEVPATH=(.+)').firstMatch(udevOutput);
        final devPathKey = udevDevPathMatch?.group(1);
        if (devPathKey != null) {
          deviceInfoForCache.addAll({
            'bus': bus ?? '',
            'device_num': deviceNum,
            'vendor_id': vendorId ?? '',
            'product_id': productId ?? '',
            'manufacturer': manufacturer,
            'product': product,
          });
          deviceCache[devPathKey] = deviceInfoForCache;
        }
      }

      final usbBlockDevices = Directory('/sys/block').listSync();
      for (final block in usbBlockDevices) {
        final devPath = block.resolveSymbolicLinksSync();
        if (devPath.contains('usb')) {
          final sizeFile = File('${block.path}/size');
          if (await sizeFile.exists()) {
            final sectors = int.tryParse(await sizeFile.readAsString()) ?? 0;
            final sizeInBytes = sectors * 512;
            device['storage_size_bytes'] = sizeInBytes;
          }
        }
      }

      usbDevices.add(device);
    }

    final log = Log(
      level: LogLevel.info,
      category: LogCategory.system,
      message: 'Sistema inicializado',
      details: usbDevices.isNotEmpty ? {'usb_devices': usbDevices} : {},
    );

    Logger.post(log).then((response) {
      if (response.statusCode == 200) {
        print('Log enviado com sucesso: ${response.body}');
      } else {
        print('Erro ao enviar log: ${response.statusCode} - ${response.body}');
      }
    }).catchError((error) {
      print('Erro ao enviar log: $error');
    });

    await Logger.startUsbDeviceListener();
  }

  static Future<void> startUsbDeviceListener() async {
    while (!Config.isDataSet) {
      await Future.delayed(const Duration(milliseconds: 100));
    }

    print("Starting USB device listener...");

    final process = await Process.start(
      'udevadm',
      ['monitor', '--subsystem-match=usb', '--udev'],
      runInShell: true,
    );

    final stdoutLines = process.stdout
        .transform(utf8.decoder)
        .transform(const LineSplitter());

    stdoutLines.listen((line) async {
      final match = RegExp(r'UDEV\s+\[\S+\]\s+(add|remove)\s+(.+)\s+\(usb\)').firstMatch(line);

      if (match != null) {
        final action = match.group(1);
        final devPath = match.group(2);

        if (devPath != null && !RegExp(r'/\d+-\d+:\d+\.\d+$').hasMatch(devPath)) {
          if (action == "add") {
            final info = await _getDeviceInfo(devPath);
            if (info != null) {
              deviceCache[devPath] = info;
              info['event'] = 'add';
              Log log = Log(
                level: LogLevel.info,
                category: LogCategory.usb,
                message: "USB device added",
                details: info,
              );
              Logger.post(log);
            }
          } else if (action == "remove") {
            final cached = deviceCache[devPath];
            if (cached != null) {
              cached['event'] = 'remove';
              Log log = Log(
                level: LogLevel.info,
                category: LogCategory.usb,
                message: "USB device removed",
                details: cached,
              );
              Logger.post(log);
              deviceCache.remove(devPath);
            } else {
              print("⚠️ No cached device info for $devPath");
            }
          }
        }
      }
    }, onError: (error) {
      stderr.writeln('Error in listener: $error');
    });
  }

  static Future<http.Response> post(Log log) async {
    if (_logFilePath == '') {
      print(JsonEncoder.withIndent('  ').convert(log.toJson()));
    } else {
      final logFile = File(_logFilePath);
      await logFile.writeAsString(
        '${log.timestamp.toIso8601String()} [${log.level.name.toUpperCase()}] ${log.category.name.toUpperCase()}: ${log.message} ${jsonEncode(log.details)}\n',
        mode: FileMode.append,
      );
    }

    if (!Config.isDataSet) return http.Response('User data not set', 400);

    var response = await http.post(
      Uri.parse("${Config.apiBaseUrl}/logs/session/${Config.getFromConfigMap('sessionID')}/user/${Config.getFromConfigMap('nmec')}"),
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer ${Config.getFromConfigMap('token')}",
      },
      body: jsonEncode(log.toJson()),
    );

    return response;
  }
}
