import 'dart:math';
import 'dart:typed_data';
import 'package:pointycastle/export.dart';

class Encryption {
  static Uint8List decryptFile(Uint8List fileData, Uint8List key, {Uint8List? iv}) {
    try {
      iv ??= fileData.sublist(0, 12);
      fileData = fileData.sublist(12);

      final gcm = GCMBlockCipher(AESEngine())
        ..init(false, ParametersWithIV(KeyParameter(key), iv));

      return gcm.process(fileData);
    } catch (e) {
      print('Erro ao desencriptar ficheiro: $e');
      return Uint8List(0);
    }
  }

  static Uint8List encryptFile(Uint8List fileData, Uint8List key) {
    try {
      final Uint8List iv = Uint8List.fromList(List<int>.generate(12, (i) => Random.secure().nextInt(256)));

      final gcm = GCMBlockCipher(AESEngine())
        ..init(true, ParametersWithIV(KeyParameter(key), iv));

      final encryptedData = gcm.process(fileData);
      return Uint8List.fromList(iv + encryptedData);
    } catch (e) {
      print('Erro ao encriptar ficheiro: $e');
      return Uint8List(0);
    }
  }
}