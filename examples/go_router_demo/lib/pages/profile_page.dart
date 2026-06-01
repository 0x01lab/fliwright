import 'package:flutter/material.dart';

class ProfileEditPage extends StatefulWidget {
  final Map<String, String>? initialData;

  const ProfileEditPage({super.key, this.initialData});

  @override
  State<ProfileEditPage> createState() => _ProfileEditPageState();
}

class _ProfileEditPageState extends State<ProfileEditPage> {
  final _nicknameController = TextEditingController();
  final _bioController = TextEditingController();
  final _websiteController = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Pre-fill from route extra data if provided
    if (widget.initialData != null) {
      _nicknameController.text = widget.initialData?['nickname'] ?? '';
      _bioController.text = widget.initialData?['bio'] ?? '';
      _websiteController.text = widget.initialData?['website'] ?? '';
    }
  }

  @override
  void dispose() {
    _nicknameController.dispose();
    _bioController.dispose();
    _websiteController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('编辑资料')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            TextField(
              controller: _nicknameController,
              decoration: const InputDecoration(
                hintText: '输入昵称',
                labelText: '昵称',
                prefixIcon: Icon(Icons.person),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _bioController,
              decoration: const InputDecoration(
                hintText: '个人简介',
                labelText: '简介',
                prefixIcon: Icon(Icons.info),
                border: OutlineInputBorder(),
              ),
              maxLines: 3,
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _websiteController,
              decoration: const InputDecoration(
                hintText: '个人网站',
                labelText: '网站',
                prefixIcon: Icon(Icons.language),
                border: OutlineInputBorder(),
              ),
              keyboardType: TextInputType.url,
            ),
            const SizedBox(height: 24),
            ElevatedButton(
              onPressed: () {
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('资料已保存')),
                );
              },
              style: ElevatedButton.styleFrom(
                padding: const EdgeInsets.symmetric(vertical: 16),
              ),
              child: const Text('保存', style: TextStyle(fontSize: 18)),
            ),
          ],
        ),
      ),
    );
  }
}
