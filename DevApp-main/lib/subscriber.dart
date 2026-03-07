import 'dart:async';
import 'dart:convert';
import 'package:duration/duration.dart';
import 'package:duration/locale.dart';
import 'package:http/http.dart' as http;
import 'package:desktop_notifications/desktop_notifications.dart';
import 'config.dart';

class Message {
  final String operation;
  final String message;
  final String courseID;
  final int examID;
  final int sessionID;

  Message(this.operation, this.message, this.courseID, this.examID, this.sessionID);

  factory Message.fromJson(Map<dynamic, dynamic> json) {
    return Message(
      json['operation'],
      json['message'] ?? '',
      json['courseID'],
      json['examID'],
      json['sessionID'],
    );
  }
}

class Subscriber {
  final List<String> notifications = [];
  bool _firstConnection = true;
  bool _connectionLossNotified = false;
  bool _connectedToServer = false;
  bool get connectedToServer => _connectedToServer;
  int unreadNotifications = 0;
  late final NotificationsClient _notificationsClient;

  // to be deleted and instead use the config file
  // late final int nmec;
  // late final int sessionUserID;
  // late final String courseID;
  // late final int examID;
  // late final int sessionID;
  bool examStarted = false;

  final StreamController<String> _controller = StreamController<String>();
  Stream<String> get _stream => _controller.stream;

  void Function()? onNotification;
  void Function()? showNotifications;
  void Function(String)? onStartExam;
  void Function(int)? onInsertTime;
  void Function(String)? onFinishExam;
  void Function()? onSendExam;

  Subscriber() {
    _initNotifications();
    _checkConnection();
  }

  Future<void> _checkConnection() async {
    bool isConnected;

    try {
      final response = await http.get(Uri.parse(Config.apiBaseUrl));
      isConnected = (response.statusCode == 200);
    } catch (e) {
      isConnected = false;
    }

    if (isConnected) {
      if (!_connectedToServer) {
        if (!_firstConnection) {
          issueNotification("Conexão restabelecida");
          _retryConnection('${Config.apiBaseUrl}/pie');
          _retryConnection('${Config.apiBaseUrl}/pie/${Config.getFromConfigMap('nmec')}');
        }
        _connectedToServer = true;
        _firstConnection = false;
        _connectionLossNotified = false;
      }
    } else {
      if (_connectedToServer && !_connectionLossNotified) {
        issueNotification("Conexão perdida");
        _connectionLossNotified = true;
      }
      _connectedToServer = false;
    }

    Future.delayed(Duration(seconds: _firstConnection ? 1 : 5), _checkConnection);
  }


  Future<void> _initNotifications() async {
    _notificationsClient = NotificationsClient();
  }

  Future<void> issueNotification(String message) async {
    DateTime now = DateTime.now();
    String formattedTime = '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}:${now.second.toString().padLeft(2, '0')}';
    notifications.add('[$formattedTime] $message');

    if (showNotifications != null) {
      onNotification!();
    }

    if (!examStarted) return;

    final notification = await _notificationsClient.notify(
      "PIE - DevApp",
      body: message,
      appName: 'PIE DevApp',
      actions: [
        NotificationAction('view_notifications', 'Ver notificações'),
      ],
    );

    notification.action.then((action) {
      if (action == 'view_notifications') {
        if (showNotifications != null) {
          showNotifications!();
        }
      }
    });
  }

  void _startListening(String url) async {
    var client = http.Client();
    var request = http.Request('GET', Uri.parse(url))
      ..headers.addAll({
        'Authorization': 'Bearer ${Config.getFromConfigMap('token')}',
        'Accept': 'application/json',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
    try {
      var response = await client.send(request);
      response.stream.transform(utf8.decoder).listen((data) {
        if (!_controller.isClosed) {
          _controller.add(data);
        }
      }, onError: (e) {
        if (!_controller.isClosed) {
          _controller.addError(e);
        }
      }, onDone: () {
        client.close();
      });
    } catch (e) {
      print('Erro ao conectar ao servidor: $e');
      return;
    }
  }

  void _retryConnection(String url) async {
    if (!_controller.isClosed) {
      _startListening(url);
    }
  }

  void dispose() {
    _controller.close();
  }

  void init() {
    _startListening('${Config.apiBaseUrl}/pie');
    _startListening('${Config.apiBaseUrl}/pie/${Config.getFromConfigMap('nmec')}');

    _stream.listen((data) {
      try {
        var json = jsonDecode(data);
        print('Subscription message received: $json');
        Message message = Message.fromJson(json);
        if (message.courseID != Config.getFromConfigMap('courseID')
          || message.examID != Config.getFromConfigMap('examID')
          || message.sessionID != Config.getFromConfigMap('sessionID')) {
          return;
        }

        switch (message.operation) {
          case 'notification':
            issueNotification(message.message);
          case 'start_exam':
            issueNotification('O exame começou');
            if (onStartExam != null) {
              onStartExam!(message.message);
            }
          case 'insert_time':
            try {
              int time = int.parse(message.message);
              Duration duration = Duration(seconds: time);
              int hours = duration.inHours;
              int minutes = duration.inMinutes.remainder(60);
              int seconds = duration.inSeconds.remainder(60);
              issueNotification('Tempo inserido: ${prettyDuration(anHour * hours + aMinute * minutes + aSecond * seconds, locale: DurationLocale.fromLanguageCode('pt')!)}');
              if (onInsertTime != null) {
                onInsertTime!(time);
              }
            } catch (e) {
              print('Erro a processar o tempo: $e');
            }
          case 'finish_exam':
            issueNotification('Exame terminado pelo professor');
            if (onFinishExam != null) {
              onFinishExam!('Exame terminado pelo professor');
            }
          case 'send_exam':
            if (onSendExam != null) {
              onSendExam!();
            }
          default:
            print('Operação desconhecida: ${message.operation}');
        }
      } catch (e) {
        print('Erro a processar a mensagem: $e');
      }
    }, onError: (e) {
      print('Erro no Subscriber: $e');
    });
  }
}
