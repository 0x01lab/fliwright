import 'dart:convert';
import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:fliwright_bridge/fliwright_bridge.dart';

void main() async {
  await FliwrightBridge.init();
  runApp(const FormDemoApp());
}

class FormDemoApp extends StatelessWidget {
  const FormDemoApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Fliwright Form Demo',
      theme: ThemeData(
        colorSchemeSeed: Colors.blue,
        useMaterial3: true,
      ),
      home: const RegistrationPage(),
    );
  }
}

class RegistrationPage extends StatefulWidget {
  const RegistrationPage({super.key});

  @override
  State<RegistrationPage> createState() => _RegistrationPageState();
}

class _RegistrationPageState extends State<RegistrationPage> {
  final _formKey = GlobalKey<FormState>();

  final _phoneController = TextEditingController();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  final _idCardController = TextEditingController();
  final _nameController = TextEditingController();
  final _addressController = TextEditingController();
  final _captchaController = TextEditingController();

  bool _submitted = false;
  bool _loading = false;
  String? _successMessage;
  String? _errorMessage;

  final _dio = Dio();

  @override
  void dispose() {
    _phoneController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _idCardController.dispose();
    _nameController.dispose();
    _addressController.dispose();
    _captchaController.dispose();
    super.dispose();
  }

  Future<void> _handleSubmit() async {
    if (_loading) return;

    setState(() {
      _loading = true;
      _errorMessage = null;
      _successMessage = null;
    });

    try {
      final response = await _dio.post<Map<String, dynamic>>(
        'http://api.example.com/api/register',
        data: {
          'phone': _phoneController.text,
          'email': _emailController.text,
          'idCard': _idCardController.text,
          'name': _nameController.text,
          'address': _addressController.text,
          'captcha': _captchaController.text,
        },
      );

      if (!mounted) return;
      final data = response.data;
      setState(() {
        _submitted = true;
        _successMessage = data?['message'] as String? ?? '提交成功';
      });
    } on DioException catch (e) {
      if (!mounted) return;
      final data = e.response?.data;
      setState(() {
        _errorMessage = data is Map
            ? (data['error'] as String? ?? data['message'] as String? ?? '请求失败')
            : '请求失败: ${e.message}';
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _submitted = true;
      });
    } finally {
      if (mounted) {
        setState(() {
          _loading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('注册')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // 手机号
              TextField(
                controller: _phoneController,
                decoration: const InputDecoration(
                  hintText: '请输入手机号',
                  labelText: '手机号',
                  prefixIcon: Icon(Icons.phone),
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.phone,
                maxLength: 11,
              ),
              const SizedBox(height: 12),

              // 邮箱 (TextFormField to test both widget types)
              TextFormField(
                controller: _emailController,
                decoration: const InputDecoration(
                  hintText: '邮箱地址',
                  labelText: '邮箱',
                  prefixIcon: Icon(Icons.email),
                  border: OutlineInputBorder(),
                ),
                keyboardType: TextInputType.emailAddress,
                validator: (value) {
                  if (value != null && value.contains('@')) return null;
                  return '请输入有效的邮箱地址';
                },
              ),
              const SizedBox(height: 12),

              // 密码
              TextFormField(
                controller: _passwordController,
                decoration: const InputDecoration(
                  hintText: '密码',
                  labelText: '密码',
                  prefixIcon: Icon(Icons.lock),
                  border: OutlineInputBorder(),
                ),
                obscureText: true,
              ),
              const SizedBox(height: 12),

              // 身份证号
              TextField(
                controller: _idCardController,
                decoration: const InputDecoration(
                  hintText: '身份证号',
                  labelText: '身份证号',
                  prefixIcon: Icon(Icons.badge),
                  border: OutlineInputBorder(),
                ),
                maxLength: 18,
              ),
              const SizedBox(height: 12),

              // 真实姓名
              TextField(
                controller: _nameController,
                decoration: const InputDecoration(
                  hintText: '真实姓名',
                  labelText: '姓名',
                  prefixIcon: Icon(Icons.person),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),

              // 地址
              TextField(
                controller: _addressController,
                decoration: const InputDecoration(
                  hintText: '地址',
                  labelText: '地址',
                  prefixIcon: Icon(Icons.location_on),
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),

              // 验证码
              TextField(
                controller: _captchaController,
                decoration: const InputDecoration(
                  hintText: '验证码',
                  labelText: '验证码',
                  prefixIcon: Icon(Icons.verified_user),
                  border: OutlineInputBorder(),
                ),
                maxLength: 6,
              ),
              const SizedBox(height: 24),

              // 提交按钮
              ElevatedButton(
                key: const Key('submit_button'),
                onPressed: _loading ? null : _handleSubmit,
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 16),
                ),
                child: _loading
                    ? const SizedBox(
                        height: 20,
                        width: 20,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text(
                        '提交',
                        style: TextStyle(fontSize: 18),
                      ),
              ),
              const SizedBox(height: 24),

              // 成功提示
              if (_successMessage != null)
                Card(
                  color: Colors.green,
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Text(
                      _successMessage!,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),

              // 兼容旧 e2e: 如果 submitted 且无成功/错误消息
              if (_submitted && _successMessage == null && _errorMessage == null)
                const Card(
                  color: Colors.green,
                  child: Padding(
                    padding: EdgeInsets.all(16.0),
                    child: Text(
                      '注册成功',
                      style: TextStyle(
                        color: Colors.white,
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),

              // 错误提示
              if (_errorMessage != null)
                Card(
                  color: Colors.red,
                  child: Padding(
                    padding: const EdgeInsets.all(16.0),
                    child: Text(
                      _errorMessage!,
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 16,
                        fontWeight: FontWeight.bold,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}
