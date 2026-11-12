import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'routes.dart';
import 'screens/home_screen.dart';
import 'screens/orders_screen.dart';
import 'screens/order_screen.dart';

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    routes: [
      GoRoute(path: Routes.home, builder: (context, state) => const HomeScreen()),
      GoRoute(
        path: Routes.orders,
        builder: (context, state) => const OrdersScreen(),
        routes: [
          GoRoute(
            path: ':id',
            builder: (context, state) => OrderScreen(id: state.pathParameters['id']!),
          ),
        ],
      ),
    ],
  );
});
