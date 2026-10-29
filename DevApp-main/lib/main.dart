import 'dart:async';
import 'dart:io';


import 'package:window_manager/window_manager.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
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
  final TextEditingController _codeController = TextEditingController();
  late final Subscriber _subscriber;
  late final Timer _connectionTimer;
  bool _appInitialized = false;
  bool _connectedToServer = false;
  bool _deviceProvisioned = false;
  bool _sessionProvisioned = false;
  bool _invalidLogin = false;
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
      _deviceProvisioned = Config.isProvisioned;
      _sessionProvisioned = Config.isSessionProvisioned;
    });

    _connectionTimer = Timer.periodic(Duration(seconds: 1), (timer) async {
      // Every second while waiting for the NFC claim, then every 10s to
      // pick up a server address changed by a later session tap (see
      // Config.fetchDeviceIdentity) — one timer instead of a second one
      // just for the Pi poll.
      if (!_deviceProvisioned || timer.tick % 10 == 0) {
        await Config.fetchDeviceIdentity();
      }
      // Same cadence for the examiner's session tap: every second while
      // waiting for it, then every 10s to pick up a re-registration (e.g.
      // the examiner fixing a wrong NMEC).
      if (!_sessionProvisioned || timer.tick % 10 == 0) {
        await Config.fetchProvisionedSession();
      }
      setState(() {
        _connectedToServer = _subscriber.connectedToServer;
        _deviceProvisioned = Config.isProvisioned;
        _sessionProvisioned = Config.isSessionProvisioned;
      });
    });
  }

  @override
  void dispose() {
    _connectionTimer.cancel();
    HardwareKeyboard.instance.addHandler(_handleKeyEvent);
    super.dispose();
  }

  Future<void> _sendId() async {
    String code = _codeController.text;

    if (code.isEmpty || !Config.isSessionProvisioned) {
      return;
    }
    // No student login: the student is the one the examiner assigned to
    // this device in the session tap, after checking their card. The
    // server takes it from the confirmed secret and returns their token.
    nmec = int.parse(Config.provisionedNmec!);

    // try {
      var response = await Config.api.post(
        Uri.parse('${Config.apiBaseUrl}/session-users/join'),
        headers: {
          "Content-Type": "application/json",
        },
        // Only the join code: the request reaches the server through the
        // Pi's tunnel (Config.apiBaseUrl is the server's tunnel address),
        // which is how the server knows the device, and from it the
        // student the examiner assigned.
        body: jsonEncode({
          "join_code": code,
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
        Config.addToConfigMap('token', data['access_token']);
        Config.addToConfigMap('nmec', nmec);
        int sessionUserID = data['id'];
        sessionID = data['session_id'];
        examID = data['exam_id'];
        courseID = data['course_id'];
        duration = data['duration'];
        // A rejoin after the exam has started: resume at once, with the
        // time left (the full time if the student had not started yet).
        bool resume = data['is_started'] == true;
        if (resume && data['remaining_seconds'] != null) {
          duration = data['remaining_seconds'];
        }
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
              resume: resume,
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
      _sendId();
      return true;
    }

    return false;
  }

  /// Shared by the "not yet provisioned" and "connecting to server" waiting
  /// screens below — both are dead ends a student can't do anything from,
  /// so both offer the same way out.
  Widget _buildPoweroffButton() {
    return ElevatedButton(
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
    );
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
                // Gated ahead of everything else below: an unclaimed device
                // (see pie-api-main/README.md, "Registering a PIE device")
                // has no deviceId yet, so session join would fail even if
                // the server connection came up — there's nothing useful
                // for a student to do here until the examiner's NFC tap
                // lands. Mirrors the existing !_connectedToServer waiting
                // state below, one tier higher.
                if (!_deviceProvisioned) ...[
                  CircularProgressIndicator(),
                  SizedBox(height: 20),
                  Text(
                    'Dispositivo não provisionado',
                    style: TextStyle(fontSize: 14, color: Colors.red),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Aproxime o telemóvel do examinador deste dispositivo para o ativar.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12),
                  ),
                  SizedBox(height: 20),
                  _buildPoweroffButton(),
                ] else if (!_sessionProvisioned) ...[
                  // The examiner taps the device after checking the
                  // student's card, before the student logs in
                  // (pie-api-main/README.md, "Joining a session").
                  CircularProgressIndicator(),
                  SizedBox(height: 20),
                  Text(
                    'A aguardar o examinador',
                    style: TextStyle(fontSize: 14, color: Colors.red),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'O examinador tem de verificar o seu cartão de estudante e aproximar o telemóvel deste dispositivo.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 12),
                  ),
                  SizedBox(height: 20),
                  _buildPoweroffButton(),
                ] else ...[
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
                    _buildPoweroffButton(),
                  ],
                  if (_connectedToServer) ...[
                    // The student the examiner assigned in the session tap.
                    // There is no login, so this is where the student sees
                    // a wrong assignment.
                    Text(
                      Config.provisionedName?.isNotEmpty == true
                          ? Config.provisionedName!
                          : 'Estudante',
                      style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
                    ),
                    Text('N.º mecanográfico: ${Config.provisionedNmec ?? ''}'),
                    SizedBox(height: 8),
                    Text(
                      'Se estes não forem os seus dados, chame o examinador.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 12),
                    ),
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
                      child: Text('Entrar no exame'),
                    ),
                    if (_invalidLogin) ...[
                      SizedBox(height: 20),
                      Text('Sessão inválida', style: TextStyle(color: Colors.red)),
                    ],
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
