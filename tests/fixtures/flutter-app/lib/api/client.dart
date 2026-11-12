import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The API host, given at build time: `--dart-define=BASE_URL=...`.
const _baseUrl = String.fromEnvironment('BASE_URL');

/// Card payments go straight to the provider.
const kPaymentsUrl = 'https://api.stripe.com/v1';

final dioProvider = Provider<Dio>((ref) {
  return Dio(BaseOptions(baseUrl: _baseUrl));
});
