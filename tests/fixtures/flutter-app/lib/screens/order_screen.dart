import 'package:flutter/material.dart';

class OrderScreen extends StatelessWidget {
  const OrderScreen({super.key, required this.id});
  final String id;

  @override
  Widget build(BuildContext context) => Text('Order $id');
}
