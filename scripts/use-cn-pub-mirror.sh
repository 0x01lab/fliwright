#!/usr/bin/env sh
# China pub mirror for Flutter/Dart package resolution.
#
# Source this when pub.dev is unreachable (e.g. behind the GFW):
#
#     source scripts/use-cn-pub-mirror.sh
#
# Then run Flutter/Dart commands normally — `flutter pub get`, `flutter test`,
# `dart test`, `melos bootstrap`. This only affects the current shell session,
# is fully opt-in, and does NOT change resolved package versions (pubspec
# constraints still apply); it only redirects where packages are downloaded
# from. Contributors outside the CN mirror's reach can ignore this file.
#
# Mirrors:
#   pub packages  -> https://pub.flutter-io.cn      (PUB_HOSTED_URL)
#   Flutter SDK   -> https://storage.flutter-io.cn  (FLUTTER_STORAGE_BASE_URL)
export PUB_HOSTED_URL=https://pub.flutter-io.cn
export FLUTTER_STORAGE_BASE_URL=https://storage.flutter-io.cn
echo "pub mirror enabled:"
echo "  PUB_HOSTED_URL=$PUB_HOSTED_URL"
echo "  FLUTTER_STORAGE_BASE_URL=$FLUTTER_STORAGE_BASE_URL"
