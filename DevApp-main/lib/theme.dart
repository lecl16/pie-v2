import 'package:flutter/material.dart';

final ThemeData appTheme = ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color.fromARGB(255, 40, 116, 43),
    primary: const Color.fromARGB(255, 40, 116, 43),
    secondary: const Color.fromARGB(255, 255, 154, 2),
    surface: Colors.white,
  ),
  elevatedButtonTheme: ElevatedButtonThemeData(
    style: ElevatedButton.styleFrom(
      backgroundColor: Colors.green,
      foregroundColor: Colors.white,
      padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
      textStyle: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
    ),
  ),
  appBarTheme: const AppBarTheme(
    backgroundColor: Color.fromARGB(255, 40, 116, 43),
    foregroundColor: Colors.white,
    centerTitle: true,
    titleTextStyle: TextStyle(fontSize: 24, fontWeight: FontWeight.bold),
  ),
);

class CustomAppBar extends AppBar {
  CustomAppBar({
    super.key,
    required Text title,
    super.actions,
    super.backgroundColor,
    super.elevation,
    // Add any other AppBar properties you want to support
  }) : super(
    leading: Container(
      alignment: Alignment.centerLeft,
      padding: const EdgeInsets.symmetric(horizontal: 10),
      child: Image.asset('assets/images/pie_icon.png', height: 40),
    ),
    title: title,
    centerTitle: true,
  );
}
