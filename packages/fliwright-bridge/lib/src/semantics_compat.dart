import 'package:flutter/semantics.dart';

/// Version-safe helpers for checking [SemanticsData] flags across
/// different Flutter SDK versions.
///
/// Flutter has changed the `SemanticsData.flags` representation multiple
/// times:
///
/// - **< 3.10**: `flags` is an `int` bitfield; `hasFlag()` does not exist.
/// - **3.10 – 3.28**: `flags` is `int`; `hasFlag(SemanticsFlag)` exists.
/// - **3.29 – 3.31**: `flags` deprecated, `hasFlag()` still works.
/// - **≥ 3.32**: `hasFlag()` deprecated; use `flagsCollection` which is a
///   [SemanticsFlags] object with boolean fields (`.isButton`, `.isLink`, …).
///
/// This class abstracts over those differences so that calling code does
/// not need to care about the running SDK version.
class SemanticsCompat {
  SemanticsCompat._();

  /// Returns `true` if [data] has [flag] set.
  ///
  /// Tries three strategies in order:
  /// 1. `flagsCollection` boolean fields (Flutter ≥ 3.29)
  /// 2. `hasFlag()` method (Flutter 3.10 – 3.31)
  /// 3. Manual int bitfield check using `SemanticsFlag.index` (Flutter < 3.10)
  static bool hasFlag(SemanticsData data, SemanticsFlag flag) {
    // Strategy 1: flagsCollection with boolean properties (Flutter ≥ 3.29).
    try {
      final collection = data.flagsCollection;
      return _checkFlagsCollection(collection, flag);
    } catch (_) {
      // flagsCollection does not exist or throws on this SDK version.
    }

    // Strategy 2: hasFlag() (Flutter 3.10 – 3.31).
    try {
      return data.hasFlag(flag); // ignore: deprecated_member_use
    } catch (_) {
      // hasFlag does not exist or throws.
    }

    // Strategy 3: manual bitfield check using index (Flutter < 3.10).
    try {
      final flags = data.flags; // ignore: deprecated_member_use
      final mask = flag.index;
      return (flags & mask) != 0;
    } catch (_) {
      return false;
    }
  }

  /// Returns `true` if [data] has any semantics flags set.
  static bool hasAnyFlags(SemanticsData data) {
    const commonFlags = <SemanticsFlag>[
      SemanticsFlag.isButton,
      SemanticsFlag.isLink,
      SemanticsFlag.isHeader,
      SemanticsFlag.isTextField,
      SemanticsFlag.isFocused,
      SemanticsFlag.hasCheckedState,
      SemanticsFlag.isSelected,
    ];
    for (final flag in commonFlags) {
      if (hasFlag(data, flag)) return true;
    }
    return false;
  }

  /// Check a SemanticsFlag against a SemanticsFlags (Flutter ≥ 3.29).
  /// SemanticsFlags has boolean fields; we map the flag name to the field.
  static bool _checkFlagsCollection(dynamic collection, SemanticsFlag flag) {
    // SemanticsFlags has named boolean fields matching SemanticsFlag names.
    // Use dynamic dispatch to access them.
    final name = flag.name;
    try {
      // Direct boolean field access: isButton, isLink, isHeader, etc.
      final value = (collection as dynamic).isButton;
      // If we got here, the collection object exists.
      // Map flag name to the corresponding boolean field.
      return _flagToBoolField(collection, name);
    } catch (_) {
      return false;
    }
  }

  /// Maps a SemanticsFlag name to the corresponding boolean field on
  /// a SemanticsFlags object via dynamic dispatch.
  static bool _flagToBoolField(dynamic flags, String flagName) {
    switch (flagName) {
      case 'isButton':
        return flags.isButton as bool;
      case 'isLink':
        return flags.isLink as bool;
      case 'isHeader':
        return flags.isHeader as bool;
      case 'isTextField':
        return flags.isTextField as bool;
      case 'isFocused':
        return flags.isFocused.value != 0;
      case 'hasCheckedState':
        return flags.isChecked.value != 0;
      case 'isSelected':
        return flags.isSelected.value != 0;
      case 'isEnabled':
        return flags.isEnabled.value != 0;
      case 'isToggled':
        return flags.isToggled.value != 0;
      case 'isObscured':
        return flags.isObscured as bool;
      case 'isHidden':
        return flags.isHidden as bool;
      case 'isImage':
        return flags.isImage as bool;
      case 'isSlider':
        return flags.isSlider as bool;
      case 'isMultiline':
        return flags.isMultiline as bool;
      case 'isReadOnly':
        return flags.isReadOnly as bool;
      case 'scopesRoute':
        return flags.scopesRoute as bool;
      case 'namesRoute':
        return flags.namesRoute as bool;
      default:
        return false;
    }
  }
}
