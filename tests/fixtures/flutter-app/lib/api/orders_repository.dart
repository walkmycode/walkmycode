import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'client.dart';

class OrdersRepository {
  OrdersRepository(this._dio);
  final Dio _dio;

  Future<Response> list() => _dio.get('/api/orders');

  Future<Response> byId(String id) => _dio.get<Map<String, dynamic>>('/api/orders/$id');

  Future<void> cancel(String id) async {
    await _dio.delete('/api/orders/${id}/cancel');
  }

  Future<void> create(Map<String, dynamic> order) async {
    await _dio.request('/api/orders', data: order, options: Options(method: 'POST'));
  }
}

final ordersRepositoryProvider = Provider((ref) => OrdersRepository(ref.read(dioProvider)));
