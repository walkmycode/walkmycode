import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../api/client.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});

  Future<void> _pay() async {
    await http.post(Uri.parse('$kPaymentsUrl/charges'), body: '{}');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: ElevatedButton(
          onPressed: _pay,
          child: const Text('Pay now'),
        ),
      ),
    );
  }
}
