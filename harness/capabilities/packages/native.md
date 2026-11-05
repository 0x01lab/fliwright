---
package: "@fliwright/native"
path: "packages/fliwright-native"
source_fingerprint: "eb0ee3ac361c9f275b476e6b5534a8eb58fc2dd26ebe41f58e4f3afda3393434"
generated: true
---

# Native Capabilities

## Responsibility

Own host platform adapters, native sessions and runners for UI automation and device test controls.

## Boundary

### May Depend On

- `@fliwright/core`
- `@fliwright/devices`

### Must Not Own

- `Flutter instrumentation`
- `Vitest lifecycle`
- `cloud scheduling`
- `CLI or editor UX`

## Owned Capabilities

- `native UI automation`
- `device test controls`

## Package Entrypoints

- `.`

## Public Exports

- `AdbSession`
- `AdbSessionOptions`
- `AndroidAppInstallInput`
- `AndroidAppLaunch`
- `AndroidInstalledApp`
- `AndroidPermissionState`
- `AndroidRecoveryOptions`
- `AndroidRecoveryReceipt`
- `AndroidRecoveryRequest`
- `createNativeSession`
- `CreateNativeSessionOptions`
- `DeviceLease`
- `DeviceLeaseDelegation`
- `DeviceLeaseInspection`
- `DeviceLeaseInspectionInput`
- `DeviceLeaseManager`
- `DeviceLeaseOptions`
- `DeviceLeaseProcessState`
- `DeviceLeaseRecordState`
- `inspectDeviceLease`
- `inspectIosRunnerRecovery`
- `inspectNativeEnvironment`
- `IosRunnerRecoveryInspection`
- `IosRunnerRecoveryOptions`
- `IosRunnerRecoveryReceipt`
- `IosRunnerRecoveryRequest`
- `NATIVE_DEVICE_LEASE_ENV`
- `NativeDeviceSession`
- `NativeDoctorOptions`
- `NativeDoctorResult`
- `NativePermissionRequest`
- `openNativeDevice`
- `OpenNativeDeviceOptions`
- `PreparedIosRunner`
- `prepareIosRunner`
- `PrepareIosRunnerOptions`
- `restoreAndroidApp`
- `restoreIosRunner`
- `verifyNativeAppProcess`

## Source Anchors

- `packages/fliwright-native/src/DeviceLease.ts`
- `packages/fliwright-native/src/DeviceRecovery.ts`
- `packages/fliwright-native/src/NativeBinding.ts`
- `packages/fliwright-native/src/NativeDeviceSession.ts`
- `packages/fliwright-native/src/NativeDoctor.ts`
- `packages/fliwright-native/src/NativeSession.ts`
- `packages/fliwright-native/src/NativeToolOwnership.ts`
- `packages/fliwright-native/src/OwnedNativeTool.ts`
- `packages/fliwright-native/src/RecoveryEvidence.ts`
- `packages/fliwright-native/src/RecoveryTransaction.ts`
- `packages/fliwright-native/src/ToolExecutor.ts`
- `packages/fliwright-native/src/android/AdbSession.ts`
- `packages/fliwright-native/src/android/AndroidApk.ts`
- `packages/fliwright-native/src/android/AndroidAppJournal.ts`
- `packages/fliwright-native/src/android/AndroidAppObservation.ts`
- `packages/fliwright-native/src/android/AndroidDeviceBinding.ts`
- `packages/fliwright-native/src/android/AndroidManagedApp.ts`
- `packages/fliwright-native/src/android/AndroidPermissionJournal.ts`
- `packages/fliwright-native/src/android/AndroidPermissionPreparation.ts`
- `packages/fliwright-native/src/android/AndroidProcessInventory.ts`
- `packages/fliwright-native/src/android/AndroidRecovery.ts`
- `packages/fliwright-native/src/android/AndroidRecoveryApi.ts`
- `packages/fliwright-native/src/android/AndroidRecoveryPlatform.ts`
- `packages/fliwright-native/src/android/AndroidRecoveryRecords.ts`
- `packages/fliwright-native/src/android/AndroidSnapshot.ts`
- `packages/fliwright-native/src/index.ts`
- `packages/fliwright-native/src/ios/IosRunnerJournal.ts`
- `packages/fliwright-native/src/ios/IosRunnerRecovery.ts`
- `packages/fliwright-native/src/ios/IosRunnerRecoveryApi.ts`
- `packages/fliwright-native/src/ios/IosSimulatorIdentity.ts`
- `packages/fliwright-native/src/ios/PrepareIosRunner.ts`
- `packages/fliwright-native/src/ios/RunnerBroker.ts`
- `packages/fliwright-native/src/ios/RunnerRecoveryClient.ts`
- `packages/fliwright-native/src/ios/XctestRunner.ts`
- `packages/fliwright-native/src/ios/XctestSession.ts`
- `packages/fliwright-native/src/ios/XctestSnapshot.ts`
