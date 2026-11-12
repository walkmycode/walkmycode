import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_app/api/orders_repository.dart';

class OrdersScreen extends ConsumerStatefulWidget {
  const OrdersScreen({super.key});

  @override
  ConsumerState<OrdersScreen> createState() => _OrdersScreenState();
}

class _OrdersScreenState extends ConsumerState<OrdersScreen> {
  final _db = FirebaseFirestore.instance;

  Future<void> _refresh() async {
    await ref.read(ordersRepositoryProvider).list();
    await _db.collection('audit').add({'event': 'refresh'});
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(icon: const Icon(Icons.refresh), tooltip: 'Refresh orders', onPressed: _refresh),
        ],
      ),
      body: StreamBuilder(
        stream: _db.collection('orders').snapshots(),
        builder: (context, snapshot) => const SizedBox(),
      ),
    );
  }
}
