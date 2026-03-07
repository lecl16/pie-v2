import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:devapp/subscriber.dart';
import 'package:devapp/theme.dart';
import 'package:duration/duration.dart';
import 'package:duration/locale.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:archive/archive.dart';
import 'package:archive/archive_io.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:window_manager/window_manager.dart';
import 'dart:io';
import 'config.dart';
import 'finish_page.dart';
import 'encryption.dart';

class Exam extends StatefulWidget {
  final Subscriber subscriber;
  final int sessionUserID;
  final String courseID;
  final int examID;
  final int sessionID;
  final int duration;
  final bool isAlreadyDownloaded;
  final String encryptionKey;
  final String exam;

  const Exam({
    super.key,
    required this.subscriber,
    required this.sessionUserID,
    required this.courseID,
    required this.examID,
    required this.sessionID,
    required this.duration,
    required this.isAlreadyDownloaded,
    required this.encryptionKey,
    required this.exam,
  });

  @override
  State<Exam> createState() => _ExamState();
}

class _ExamState extends State<Exam> {
  BuildContext? _dialogContext;

  late final Timer _connectionTimer;
  String _statusMessage = 'Fetching exam...';
  bool _downloadFailed = false;
  late Duration _examDuration;
  late Timer _timer;
  bool _connectedToServer = true;

  @override
  void initState() {
    _examDuration = Duration(seconds: widget.duration);
    super.initState();
    if (widget.exam == 'files') {
      if (!widget.isAlreadyDownloaded) {
        _downloadExam();
      } else {
        _startExam(widget.encryptionKey);
      }
    } else {
      if (!widget.isAlreadyDownloaded) {
        setState(() {
          _statusMessage = 'A aguardar início do exame...';
        });
      } else {
        setState(() {
          _statusMessage = 'Exame já iniciado.';
        });
        _startExam(widget.encryptionKey);
      }
    }

    widget.subscriber.onNotification = _showNotifications;
    widget.subscriber.showNotifications = _showNotificationsDialog;
    widget.subscriber.onStartExam = _startExam;
    widget.subscriber.onInsertTime = _insertTime;
    widget.subscriber.onFinishExam = _finishExam;
    widget.subscriber.onSendExam = _submitExam;

    _connectionTimer = Timer.periodic(Duration(seconds: 1), (timer) {
      setState(() {
        _connectedToServer = widget.subscriber.connectedToServer;
      });
    });
  }

  @override
  void dispose() {
    _timer.cancel();
    _connectionTimer.cancel();
    super.dispose();
  }

  Future<void> _downloadExam() async {
    setState(() {
      _statusMessage = 'Downloading exam...';
      _downloadFailed = false;
    });

    try {
      var response = await http.get(
        Uri.parse('${Config.apiBaseUrl}/course/${widget.courseID}/${widget.examID}/${widget.sessionID}/download'),
        headers: {
          'Authorization': 'Bearer ${Config.getFromConfigMap('token')}',
        },
      );
      print('Código de Resposta: ${response.statusCode}');
      print('Cabeçalhos: ${response.headers}');

      if (response.statusCode == 200) {
        String fileName = 'exam_${widget.examID}.pdf';
        String? contentDisposition = response.headers['content-disposition'];

        if (contentDisposition != null) {
          RegExp regex = RegExp('filename="(.+)"');
          Match match = regex.firstMatch(contentDisposition)!;
          fileName = match.group(1)!;
        }

        Directory examDir = Directory(Config.examDirectory);
        String filePath = '${examDir.path}/$fileName';

        File file = File(filePath);
        await file.writeAsBytes(response.bodyBytes);

        setState(() {
          _statusMessage = 'Download efetuado com sucesso!\n\nFicheiros guardados em:\n${examDir.path}\n\nAguarde pelo início do exame.';
        });
      } else {
        print('Erro: ${response.statusCode} - ${response.body}');
        setState(() {
          _statusMessage = 'Não foi possível descarregar o exame: erro ${response.statusCode}';
          _downloadFailed = true;
        });
      }
    } catch (e) {
      print('Erro ao conectar ao servidor: $e');
      setState(() {
        _statusMessage = 'Erro ao conectar ao servidor: $e';
        _downloadFailed = true;
      });
    }
  }

  void _showNotifications() {
    setState(() {
      widget.subscriber.unreadNotifications++;
    });

    if (widget.subscriber.examStarted) return;

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
                          subtitle: timestamp.isNotEmpty
                              ? Text(
                                  timestamp,
                                  style: TextStyle(fontSize: 12, color: Colors.grey[600]),
                                )
                              : null,
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

  void _startExam(String key) async {
    if (!widget.isAlreadyDownloaded && key != "" && widget.exam == 'files') {
      http.post(
        Uri.parse('${Config.apiBaseUrl}/submission/${widget.sessionUserID}/start'),
        headers: {
          'Authorization': 'Bearer ${Config.getFromConfigMap('token')}',
        },
      );

      final keyBytes = Uint8List.fromList(base64Url.decode(key));
      try {
        final examDir = Directory(Config.examDirectory);
        final examFiles = examDir.listSync().whereType<File>().toList();
        if (examFiles.isEmpty) {
          _finishExam('Erro: Ficheiros do exame não encontrados');
          return;
        }
        final examFile = examFiles.first.path;
        final fileData = await File(examFile).readAsBytes();
        final decryptedData = Encryption.decryptFile(fileData, keyBytes);
        final outputFile = examFile.replaceAll(RegExp(r'\.encrypted$'), '');
        await File(outputFile).writeAsBytes(decryptedData);
        await File(examFile).delete();

        if (outputFile.endsWith('.zip')) {
          File file = File(outputFile);
          List<int> bytes = file.readAsBytesSync();
          Archive archive = ZipDecoder().decodeBytes(bytes);

          for (ArchiveFile archiveFile in archive) {
            String archiveFileName = archiveFile.name;
            File outFile = File('${examDir.path}/$archiveFileName');
            outFile = await outFile.create(recursive: true);
            await outFile.writeAsBytes(archiveFile.content as List<int>);
          }

          await file.delete();

          print('Download and unzip successful! Files saved in: ${examDir.path}');
        } else {
          print('Download successful! File saved in: $outputFile');
        }
      } catch (e) {
        _finishExam('Erro ao desencriptar ficheiro');
        return;
      }
    } else {
      setState(() {
        _statusMessage = 'Exame iniciado';
      });
    }

    if (_dialogContext != null) {
      Navigator.of(_dialogContext!).pop();
      _dialogContext = null;
    }

    setState(() {
      widget.subscriber.examStarted = true;
      windowManager.ungrabKeyboard();
      windowManager.setFullScreen(false);
      windowManager.setAsFrameless();
      windowManager.setSize(Size(1000, 650));
      windowManager.center();
      _startTimer();
    });
  }

  void _startTimer() {
    _timer = Timer.periodic(Duration(seconds: 1), (timer) {
      setState(() {
        if (_examDuration.inSeconds > 0) {
          _examDuration -= Duration(seconds: 1);
        } else {
          _finishExam("Tempo esgotado!");
        }
        if (_examDuration.inSeconds % 300 == 0) {
          _submitExam();
        }
        if ([1800, 600, 300, 60].contains(_examDuration.inSeconds)) {
          var naturalLang = prettyDuration(aMinute * _examDuration.inMinutes, locale: DurationLocale.fromLanguageCode('pt')!);
          widget.subscriber.issueNotification('Falta${_examDuration.inMinutes == 1 ? '' : 'm'} $naturalLang para terminar o exame');
          widget.subscriber.unreadNotifications++;
        }
        if (_examDuration.inSeconds % 3600 == 0 && _examDuration.inHours > 0) {
          var naturalLang = prettyDuration(anHour * _examDuration.inHours, locale: DurationLocale.fromLanguageCode('pt')!);
          widget.subscriber.issueNotification('Falta${_examDuration.inHours == 1 ? '' : 'm'} $naturalLang para terminar o exame');
          widget.subscriber.unreadNotifications++;
        }
      });
    });
  }

  void _insertTime(int seconds) {
    setState(() {
      _examDuration += Duration(seconds: seconds);
    });
  }

  void _finishExam(String finalMessage) {
    _timer.cancel();
    widget.subscriber.examStarted = false;
    _submitExam();

    windowManager.setFullScreen(true);
    windowManager.grabKeyboard();
    windowManager.focus();

    http.post(
      Uri.parse('${Config.apiBaseUrl}/submission/${widget.sessionUserID}/end'),
      headers: {
        'Authorization': 'Bearer ${Config.getFromConfigMap('token')}',
      },
    );

    Navigator.pushReplacement(context, MaterialPageRoute(builder: (context) => FinishedExamPage(subscriber: widget.subscriber, finalMessage: finalMessage, exam: widget.exam)));
  }

  void _confirmFinishExam(String finalMessage) {
    showDialog(
      context: context,
      builder: (BuildContext context) {
        return AlertDialog(
          title: Text('Confirmar Submissão'),
          content: Text('Tem a certeza que deseja submeter o exame?'),
          actions: [
            TextButton(
              onPressed: () {
                Navigator.of(context).pop(); // Close the dialog
              },
              child: Text('Cancelar'),
            ),
            TextButton(
              onPressed: () {
                Navigator.of(context).pop(); // Close the dialog
                _finishExam(finalMessage); // Submit the exam
              },
              child: Text('Submeter'),
            ),
          ],
        );
      },
    );
  }

  Future<void> _submitExam() async {
    final examDir = Directory(Config.examDirectory);
    final examFiles = examDir.listSync(recursive: true);
    final zipFile = File('${examDir.path}/submission.zip');
    final encoder = ZipFileEncoder();
    encoder.create(zipFile.path);
    for (final file in examFiles) {
      final relativePath = file.path.substring(examDir.path.length + 1);
      encoder.addFile(File(file.path), relativePath);
    }
    encoder.close();

    var request = http.MultipartRequest('POST', Uri.parse('${Config.apiBaseUrl}/submission/create?session_user_id=${widget.sessionUserID.toString()}'))
      ..files.add(await http.MultipartFile.fromPath(
        'submission_file',
        zipFile.path,
        contentType: MediaType('application', 'zip'),
      ))
      ..headers.addAll({
        'Authorization': 'Bearer ${Config.getFromConfigMap('token')}',
      });
    try {
      var response = await request.send();

      if (response.statusCode == 200) {
        print('Exame submetido com sucesso');
      } else {
        print('Erro ao submeter exame: ${response.statusCode} - ${response.reasonPhrase}');
      }
    } catch (e) {
      print('Erro ao submeter exame: $e');
      widget.subscriber.issueNotification('Erro ao submeter exame');
    } finally {
      if (await zipFile.exists()) {
        await zipFile.delete();
      }
    }
  }

  void _showEnabledWebsitesDialog() {
    final file = File(Config.whitelistFile);
    if (!file.existsSync()) {
      print('Whitelist file not found');
      return;
    }
    final fileContent = file.readAsStringSync();
    final enabledWebsites = fileContent.split(',').where((link) => link.isNotEmpty).toList();

    showDialog(
      context: context,
      builder: (BuildContext context) {
        _dialogContext = context;
        return AlertDialog(
          backgroundColor: Colors.white.withOpacity(0.9),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(15),
          ),
          title: Row(
            children: [
              Icon(Icons.link, color: Colors.blue[700]),
              SizedBox(width: 10),
              Text(
                'Sites permitidos',
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
            child: enabledWebsites.isEmpty
                ? Center(
                    child: Text(
                      'Sem sites permitidos',
                      style: TextStyle(
                        fontSize: 16,
                        color: Colors.grey[600],
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  )
                : ListView.builder(
                    shrinkWrap: true,
                    itemCount: enabledWebsites.length,
                    itemBuilder: (context, index) {
                      final website = Uri.parse(enabledWebsites[enabledWebsites.length - 1 - index].trim());

                      return Card(
                        elevation: 2,
                        margin: EdgeInsets.symmetric(vertical: 5, horizontal: 2),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(10),
                        ),
                        child: ListTile(
                          onTap: widget.subscriber.examStarted
                            ? () async {
                              if (await canLaunchUrl(website)) {
                                await launchUrl(website, mode: LaunchMode.externalApplication);
                              } else {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  SnackBar(content: Text('Não foi possível abrir o site.')),
                                );
                              }
                            }
                            : null,
                          leading: Icon(Icons.open_in_new, color: Colors.blue[700]),
                          title: Text(
                            website.toString(),
                            style: TextStyle(
                              fontSize: 15,
                              color: Colors.blue[800],
                              decoration: TextDecoration.underline,
                            ),
                          ),
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
    ).then((_) {
      _dialogContext = null;
    });
  }

  String _formatDuration(Duration duration) {
    String twoDigits(int n) => n.toString().padLeft(2, '0');
    String twoDigitHours = twoDigits(duration.inHours);
    String twoDigitMinutes = twoDigits(duration.inMinutes.remainder(60));
    String twoDigitSeconds = twoDigits(duration.inSeconds.remainder(60));
    return "$twoDigitHours:$twoDigitMinutes:$twoDigitSeconds";
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: CustomAppBar(
        title: Text("PIE - Exame"),
        actions: [
          IconButton(
            icon: Icon(Icons.link),
            onPressed: _showEnabledWebsitesDialog,
            tooltip: 'Mostrar Sites',
          ),
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
            child: widget.subscriber.examStarted
                ? Column(
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
                        'Exame em progresso',
                        style: TextStyle(fontSize: 24),
                      ),
                      SizedBox(height: 20),
                      Text(
                        'Tempo restante: ${_formatDuration(_examDuration)}',
                        style: TextStyle(fontSize: 24),
                      ),
                      SizedBox(height: 20),
                      if (widget.exam != 'files')
                        ElevatedButton(
                          onPressed: () async {
                            if (await canLaunchUrl(Uri.parse(widget.exam))) {
                              await launchUrl(Uri.parse(widget.exam), mode: LaunchMode.externalApplication);
                            } else {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('Não foi possível abrir o site do exame.')),
                              );
                            }
                          },
                          child: Text('Abrir no Browser'),
                        ),
                      SizedBox(height: 20),
                      Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          ElevatedButton(
                            onPressed: () {
                              _confirmFinishExam('Exame terminado pelo utilizador');
                            },
                            child: Text('Terminar e submeter exame'),
                          ),
                          SizedBox(width: 10),
                          ElevatedButton(
                            onPressed: () async {
                              await windowManager.minimize();
                            },
                            style: ElevatedButton.styleFrom(
                              backgroundColor: Colors.grey[400],
                            ),
                            child: Text(
                              'Minimizar aplicação',
                              textWidthBasis: TextWidthBasis.longestLine,
                            ),
                          ),
                        ],
                      )
                    ],
                  )
                : Column(
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
                        _statusMessage,
                        style: TextStyle(fontSize: 24),
                        textAlign: TextAlign.center,
                      ),
                      SizedBox(height: 20),
                      if (_downloadFailed)
                        ElevatedButton(
                          onPressed: _downloadExam,
                          child: Text('Tentar novamente'),
                        ),
                    ],
                  ),
          ),
        ),
      ),
    );
  }
}
