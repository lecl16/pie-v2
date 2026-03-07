import 'dart:async';
import 'dart:io';

import 'package:window_manager/window_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';
import 'config.dart';
import 'logger.dart';
import 'subscriber.dart';
import 'exam_page.dart';
import 'theme.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  await Config.load();
  await Logger.init();
  await Logger.startBashListener();

  // Clear exam directory
  final examDir = Directory(Config.examDirectory);
  if (!await examDir.exists()) {
    await examDir.create(recursive: true);
  }
  for (final entity in examDir.listSync(recursive: true)) {
    await entity.delete();
  }

  await windowManager.ensureInitialized();
  await windowManager.setPreventClose(true);
  await windowManager.setFullScreen(true);
  await windowManager.grabKeyboard();
  await windowManager.show();

  runApp(ExamApp());
}

class ExamApp extends StatelessWidget {
  const ExamApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'PIE Exam App',
      theme: appTheme,
      home: ExamHomePage(),
    );
  }
}

class ExamHomePage extends StatefulWidget {
  const ExamHomePage({super.key});

  @override
  State<ExamHomePage> createState() => _ExamHomePageState();
}

class _ExamHomePageState extends State<ExamHomePage> {
  final TextEditingController _usernameController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();
  bool _passwordVisible = false;
  final TextEditingController _codeController = TextEditingController();
  late final Subscriber _subscriber;
  late final Timer _connectionTimer;
  bool _appInitialized = false;
  bool _connectedToServer = false;
  bool _showIdField = false;
  bool _invalidLogin = false;
  String email = '';
  int nmec = 0;
  int examID = 0;
  String courseID = '';
  int sessionID = 0;
  int duration = 0;

  final Set<LogicalKeyboardKey> _disabledKeys = <LogicalKeyboardKey>{
    LogicalKeyboardKey.fn,
    LogicalKeyboardKey.f1,
    LogicalKeyboardKey.f2,
    LogicalKeyboardKey.f3,
    LogicalKeyboardKey.f4,
    LogicalKeyboardKey.f5,
    LogicalKeyboardKey.f6,
    LogicalKeyboardKey.f7,
    LogicalKeyboardKey.f8,
    LogicalKeyboardKey.f9,
    LogicalKeyboardKey.f10,
    LogicalKeyboardKey.f11,
    LogicalKeyboardKey.f12,
    LogicalKeyboardKey.alt,
    LogicalKeyboardKey.altLeft,
    LogicalKeyboardKey.altRight,
    LogicalKeyboardKey.print,
    LogicalKeyboardKey.printScreen,
    LogicalKeyboardKey.superKey,
    LogicalKeyboardKey.control,
  };

  @override
  void initState() {
    super.initState();

    _subscriber = Subscriber();
    _subscriber.onNotification = _showNotifications;
    _subscriber.showNotifications = _showNotificationsDialog;

    HardwareKeyboard.instance.addHandler(_handleKeyEvent);

    setState(() {
      _appInitialized = true;
    });

    _connectionTimer = Timer.periodic(Duration(seconds: 1), (timer) {
      setState(() {
        _connectedToServer = _subscriber.connectedToServer;
      });
    });
  }

  @override
  void dispose() {
    _connectionTimer.cancel();
    HardwareKeyboard.instance.addHandler(_handleKeyEvent);
    super.dispose();
  }

  Future<void> _login() async {
    String inputEmail = _usernameController.text;
    String inputPassword = _passwordController.text;

    if (inputEmail.isEmpty || inputPassword.isEmpty) {
      return;
    }

    try {
      var response = await http.post(
        Uri.parse('${Config.apiBaseUrl}/users/login'),
        headers: {
          "Content-Type": "application/json",
        },
        body: jsonEncode({"email": inputEmail, "password": inputPassword}),
      );

      if (response.statusCode == 200) {
        var data = jsonDecode(response.body);
        var token = data['access_token'];
        nmec = data['nmec'];
        Config.addToConfigMap('token', token);
        Config.addToConfigMap('nmec', nmec);
        print('Login bem-sucedido: $data');
        setState(() {
          _showIdField = true;
          _invalidLogin = false;
        });
      } else {
        print('Erro no login: ${response.statusCode} - ${response.body}');
        setState(() {
          _invalidLogin = true;
        });
      }
    } catch (e) {
      _subscriber.issueNotification('Erro ao estabelecer ligação ao servidor. Tente novamente.');
    }

    email = inputEmail;
  }

  Future<void> _sendId() async {
    String code = _codeController.text;

    if (code.isEmpty) {
      return;
    }

    // try {
      var response = await http.post(
        Uri.parse('${Config.apiBaseUrl}/session-users/create'),
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer ${Config.getFromConfigMap('token')}"
        },
        body: jsonEncode({
          "user_nmec": nmec,
          "user_email": email,
          "join_code": code,
          "device_id": Config.deviceId
        }),
      );

      if (response.statusCode == 200) {
        var data = jsonDecode(response.body);
        print('ID enviado com sucesso. Response: $data');
        if (data['id'] == null
         || data['session_id'] == null
         || data['exam_id'] == null
         || data['course_id'] == null
         || data['duration'] == null
         || data['exam'] == null
        ) {
          setState(() {
            _invalidLogin = true;
          });
          _subscriber.issueNotification('Dados inválidos recebidos do servidor. Tente novamente.');
          return;
        }
        int sessionUserID = data['id'];
        sessionID = data['session_id'];
        examID = data['exam_id'];
        courseID = data['course_id'];
        duration = data['duration'];
        Config.addToConfigMap('sessionUserID', sessionUserID);
        Config.addToConfigMap('sessionID', sessionID);
        Config.addToConfigMap('examID', examID);
        Config.addToConfigMap('courseID', courseID);

        String exam = data['exam'];

        var allowedLinks = [];
        if (exam != "files") allowedLinks.add(exam);
        if (data['allowed_links'] != null) allowedLinks.addAll(data['allowed_links']);
        if (allowedLinks.isNotEmpty) {
          var allowedLinksString = allowedLinks.join(', ');
          File(Config.whitelistFile).writeAsStringSync(allowedLinksString);
        }

        _subscriber.init();

        await Logger.sendInitializationLog();

        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (context) => Exam(
              subscriber: _subscriber,
              sessionUserID: sessionUserID,
              courseID: courseID,
              examID: examID,
              sessionID: sessionID,
              duration: duration,
              isAlreadyDownloaded: false,
              encryptionKey: '',
              exam: exam,
            ),
          ),
        );
      } else {
        var data = jsonDecode(response.body);
        print('Erro ao enviar ID: $data');
        setState(() {
          _invalidLogin = true;
        });
      }
    // } catch (e) {
    //   _subscriber.issueNotification('Erro ao estabelecer ligação ao servidor. Tente novamente.');
    //   print('Erro ao enviar ID: $e');
    // }
  }

  void _showNotifications() {
    setState(() {
      _subscriber.unreadNotifications++;
    });

    if (_subscriber.notifications.isNotEmpty) {
      final latestNotification = _subscriber.notifications.last;

      final notificationText = latestNotification.substring(latestNotification.indexOf('] ') + 2);

      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(notificationText),
          duration: Duration(seconds: 5),
          behavior: SnackBarBehavior.floating,
          margin: EdgeInsets.only(bottom: 10, left: 10, right: 10),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(8),
          ),
          action: SnackBarAction(
            label: 'Ver todas',
            onPressed: _showNotificationsDialog,
          ),
        ),
      );
    }
  }

  void _showNotificationsDialog() {
    setState(() {
      _subscriber.unreadNotifications = 0;
    });

    windowManager.focus();

    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          backgroundColor: Colors.white.withOpacity(0.9),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(15),
          ),
          title: Row(
            children: [
              Icon(Icons.notifications, color: Colors.blue[700]),
              SizedBox(width: 10),
              Text(
                'Notificações',
                style: TextStyle(
                  color: Colors.blue[800],
                  fontWeight: FontWeight.bold,
                ),
              ),
            ],
          ),
          content: Container(
            width: double.maxFinite * 0.9,
            height: double.maxFinite * 0.8,
            child: _subscriber.notifications.isEmpty
                ? Center(
              child: Text(
                'Sem notificações',
                style: TextStyle(
                  fontSize: 16,
                  color: Colors.grey[600],
                  fontStyle: FontStyle.italic,
                ),
              ),
            )
                : ListView.builder(
              shrinkWrap: true,
              itemCount: _subscriber.notifications.length,
              itemBuilder: (context, index) {
                final notification = _subscriber.notifications[_subscriber.notifications.length - 1 - index];

                // Parse the notification to separate timestamp from content
                String timestamp = "";
                String content = notification;

                final timestampMatch = RegExp(r'^\[(.*?)\]').firstMatch(notification);
                if (timestampMatch != null) {
                  timestamp = timestampMatch.group(1) ?? "";
                  content = notification.substring(notification.indexOf('] ') + 2);
                }

                return Card(
                  elevation: 2,
                  margin: EdgeInsets.symmetric(vertical: 5, horizontal: 2),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: ListTile(
                    leading: Icon(Icons.info_outline, color: Colors.blue[700]),
                    title: Text(
                      content,
                      style: TextStyle(fontSize: 15),
                    ),
                    subtitle: timestamp.isNotEmpty ? Text(
                      timestamp,
                      style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                    ) : null,
                    contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  ),
                );
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              style: TextButton.styleFrom(
                backgroundColor: Colors.blue[700],
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                ),
                padding: EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              ),
              child: Text('Fechar'),
            ),
          ],
        );
      },
    );
  }

  bool _handleKeyEvent(KeyEvent event) {
    if (event is! KeyDownEvent) return false;

    final key = event.logicalKey;
    final pressedKeys = HardwareKeyboard.instance.logicalKeysPressed;

    final isCtrlPressed = pressedKeys.contains(LogicalKeyboardKey.controlLeft) ||
        pressedKeys.contains(LogicalKeyboardKey.controlRight);

    final isShiftPressed = pressedKeys.contains(LogicalKeyboardKey.shiftLeft) ||
        pressedKeys.contains(LogicalKeyboardKey.shiftRight);

    final isAltPressed = pressedKeys.contains(LogicalKeyboardKey.altLeft) ||
        pressedKeys.contains(LogicalKeyboardKey.altRight);

    // final isSuperPressed = pressedKeys.contains(LogicalKeyboardKey.metaLeft) ||
    //     pressedKeys.contains(LogicalKeyboardKey.metaRight);

    if (key == LogicalKeyboardKey.semicolon && isCtrlPressed && isShiftPressed && isAltPressed) {
      Process.run('pkill', ['-KILL', '-u', Platform.environment['USER']!], runInShell: true);
      return true;
    }

    // Skip disabled keys
    if (_disabledKeys.contains(key)) {
      return true;
    }

    // Handle Enter
    if (key == LogicalKeyboardKey.enter) {
      if (_showIdField) {
        _sendId();
      } else {
        _login();
      }
      return true;
    }

    return false;
  }


  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('PIE - Login'),
        actions: [
          Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                icon: Icon(Icons.notifications),
                onPressed: _showNotificationsDialog,
                tooltip: 'Mostrar Notificações',
              ),
              if (_subscriber.unreadNotifications > 0)
                Positioned(
                  top: 8,
                  right: 8,
                  child: Container(
                    padding: EdgeInsets.all(2),
                    decoration: BoxDecoration(
                      color: Colors.red,
                      borderRadius: BorderRadius.circular(10),
                    ),
                    constraints: BoxConstraints(
                      minWidth: 16,
                      minHeight: 16,
                    ),
                    child: Text(
                      '${_subscriber.unreadNotifications}',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 10,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
      body: Container(
        decoration: BoxDecoration(
          image: DecorationImage(
            image: AssetImage('assets/images/background.jpg'),
            fit: BoxFit.cover,
            colorFilter: ColorFilter.mode(Colors.black.withOpacity(0.5), BlendMode.darken),
          ),
        ),
        child: Center(
          child: Container(
            width: 350,
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Colors.white.withOpacity(0.8),
              borderRadius: BorderRadius.circular(15),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(0.5),
                  spreadRadius: 5,
                  blurRadius: 7,
                  offset: Offset(0, 3),
                ),
              ],
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Padding(
                  padding: const EdgeInsets.only(top: 15, bottom: 15),
                  child: Image.asset(
                    'assets/images/pie_icon.png',
                    height: 80,
                  ),
                ),
                SizedBox(height: 20),
                Text(
                  'Estado da conexão: ${_connectedToServer ? 'Conectado' : 'Desconectado'}',
                  style: TextStyle(
                      fontSize: 14,
                      color: _connectedToServer ? Colors.green : Colors.red
                  ),
                ),
                SizedBox(height: 20),
                if (!_appInitialized) ...[
                  CircularProgressIndicator(),
                  SizedBox(height: 20),
                  Text('A inicializar aplicação...'),
                ],
                if (_appInitialized && !_connectedToServer) ...[
                  CircularProgressIndicator(),
                  SizedBox(height: 20),
                  Text('A conectar ao servidor...'),
                  SizedBox(height: 20),
                  ElevatedButton(
                    onPressed: () async {
                      final result = await Process.run('/sbin/poweroff', [], runInShell: true);

                      if (result.exitCode == 0) {
                        print('Sistema encerrado com sucesso.');
                      } else {
                        _subscriber.issueNotification('Erro ao encerrar o sistema.');
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.red[700],
                      foregroundColor: Colors.white,
                    ),
                    child: Text('Cancelar e Fechar'),
                  ),
                ],
                if (_connectedToServer) ...[
                  SizedBox(
                    width: 250,
                    height: 50,
                    child: TextFormField(
                      controller: _usernameController,
                      decoration: InputDecoration(
                        labelText: 'E-mail',
                        prefixIcon: Icon(Icons.person),
                        border: OutlineInputBorder(),
                      ),
                    ),
                  ),
                  SizedBox(height: 10,),
                  SizedBox(
                    width: 250,
                    height: 50,
                    child: TextFormField(
                      controller: _passwordController,
                      obscureText: !_passwordVisible,
                      decoration: InputDecoration(
                        border: OutlineInputBorder(),
                        labelText: 'Password',
                        prefixIcon: Icon(Icons.lock),
                        suffixIcon: IconButton(
                          icon: Icon(
                            _passwordVisible ? Icons.visibility : Icons.visibility_off,
                          ),
                          onPressed: () {
                            setState(() {
                              _passwordVisible = !_passwordVisible;
                            });
                          },
                        ),
                      ),
                    ),
                  ),
                  SizedBox(height: 20),
                  ElevatedButton(
                    onPressed: _login,
                    child: Text('Autenticar'),
                  ),
                  if (_invalidLogin && !_showIdField) ...[
                    SizedBox(height: 20),
                    Text('Credenciais inválidas', style: TextStyle(color: Colors.red)),
                  ],
                  if (_showIdField) ...[
                    SizedBox(height: 20),
                    SizedBox(
                      width: 250,
                      height: 50,
                      child: TextFormField(
                        controller: _codeController,
                        decoration: InputDecoration(
                          labelText: 'Código da Sessão',
                          prefixIcon: Icon(Icons.perm_identity),
                          border: OutlineInputBorder(),
                        ),
                      ),
                    ),
                    SizedBox(height: 20),
                    ElevatedButton(
                      onPressed: _sendId,
                      child: Text('Enviar código'),
                    ),
                  ],
                  if (_invalidLogin && _showIdField) ...[
                    SizedBox(height: 20),
                    Text('Sessão inválida', style: TextStyle(color: Colors.red)),
                  ],
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}
