import 'dart:async';
import 'dart:io';

import 'package:devapp/config.dart';
import 'package:devapp/exam_page.dart';
import 'package:devapp/subscriber.dart';
import 'package:devapp/theme.dart';
import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

class FinishedExamPage extends StatefulWidget {
  final Subscriber subscriber;
  final String finalMessage;
  final String exam;

  const FinishedExamPage({
    super.key,
    required this.subscriber,
    required this.finalMessage,
    required this.exam,
  });

  @override
  State<FinishedExamPage> createState() => _FinishedExamPageState();
}

class _FinishedExamPageState extends State<FinishedExamPage> {
  late final Timer _connectionTimer;
  bool _restartingExam = false;
  bool _connectedToServer = true;

  @override
  void initState() {
    super.initState();
    widget.subscriber.onInsertTime = _insertTime;
    widget.subscriber.onNotification = _showNotifications;
    widget.subscriber.showNotifications = _showNotificationsDialog;

    _connectionTimer = Timer.periodic(Duration(seconds: 1), (timer) {
      setState(() {
        _connectedToServer = widget.subscriber.connectedToServer;
      });
    });
  }

  @override
  void dispose() {
    if (!_restartingExam) {
      widget.subscriber.dispose();
    }
    _connectionTimer.cancel();
    super.dispose();
  }

  void _showNotifications() {
    setState(() {
      widget.subscriber.unreadNotifications++;
    });

    if (widget.subscriber.notifications.isNotEmpty) {
      final latestNotification = widget.subscriber.notifications.last;

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
      widget.subscriber.unreadNotifications = 0;
    });

    windowManager.restore();

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
            child: widget.subscriber.notifications.isEmpty
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
              itemCount: widget.subscriber.notifications.length,
              itemBuilder: (context, index) {
                final notification = widget.subscriber.notifications[widget.subscriber.notifications.length - 1 - index];

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

  void _insertTime(int seconds) {
    _restartingExam = true;
    Navigator.pushReplacement(context, MaterialPageRoute(builder: (context) => Exam(
      subscriber: widget.subscriber,
      sessionUserID: Config.getFromConfigMap('sessionUserID'),
      courseID: Config.getFromConfigMap('courseID'),
      examID: Config.getFromConfigMap('examID'),
      sessionID: Config.getFromConfigMap('sessionID'),
      duration: seconds,
      isAlreadyDownloaded: true,
      encryptionKey: '',
      exam: widget.exam,
    )));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: CustomAppBar(
        title: Text("PIE - Exame Terminado"),
        actions: [
          Stack(
            alignment: Alignment.center,
            children: [
              IconButton(
                icon: Icon(Icons.notifications),
                onPressed: _showNotificationsDialog,
                tooltip: 'Mostrar Notificações',
              ),
              if (widget.subscriber.unreadNotifications > 0)
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
                      '${widget.subscriber.unreadNotifications}',
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
            width: 750,
            padding: EdgeInsets.symmetric(horizontal: 20, vertical: 40),
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
                Text(
                  'Estado da conexão: ${_connectedToServer ? 'Conectado' : 'Desconectado'}',
                  style: TextStyle(
                      fontSize: 14,
                      color: _connectedToServer ? Colors.green : Colors.red
                  ),
                ),
                SizedBox(height: 20),
                Text(
                  'Exame terminado',
                  style: TextStyle(fontSize: 24),
                ),
                Text(
                  widget.finalMessage,
                  style: TextStyle(fontSize: 24),
                ),
                SizedBox(height: 20),
                Text(
                  'O seu exame foi submetido com sucesso.',
                  style: TextStyle(fontSize: 24),
                ),
                SizedBox(height: 20),
                ElevatedButton(
                  onPressed: () async {
                    final result = await Process.run('/sbin/poweroff', [], runInShell: true);

                    if (result.exitCode == 0) {
                      print('Sistema encerrado com sucesso.');
                    } else {
                      widget.subscriber.issueNotification('Erro ao encerrar o sistema.');
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red[700],
                    foregroundColor: Colors.white,
                    padding: EdgeInsets.symmetric(horizontal: 20, vertical: 10),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(8),
                    ),
                  ),
                  child: Text('Fechar'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
