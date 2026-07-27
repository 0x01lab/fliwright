package dev.fliwright.designqa

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.plugin.common.EventChannel
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel

class FliwrightDesignQaPlugin :
    FlutterPlugin,
    MethodChannel.MethodCallHandler,
    EventChannel.StreamHandler,
    SensorEventListener {
    private lateinit var methodChannel: MethodChannel
    private lateinit var accelerometerChannel: EventChannel
    private lateinit var transportControlChannel: EventChannel
    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null
    private var accelerometerSink: EventChannel.EventSink? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        methodChannel = MethodChannel(binding.binaryMessenger, "fliwright_design_qa/transport")
        methodChannel.setMethodCallHandler(this)

        accelerometerChannel = EventChannel(binding.binaryMessenger, "fliwright_design_qa/accelerometer")
        accelerometerChannel.setStreamHandler(this)

        transportControlChannel = EventChannel(
            binding.binaryMessenger,
            "fliwright_design_qa/transport_control",
        )
        transportControlChannel.setStreamHandler(TransportControlStreamHandler())

        sensorManager = binding.applicationContext.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        result.error(
            "TRANSPORT_UNAVAILABLE",
            "The Fliwright Design QA WebRTC transport is not installed for Android.",
            "Implement the Fliwright-owned WebRTC transport before pairing a device.",
        )
    }

    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) {
        val sensor = accelerometer
        if (sensor == null) {
            events?.error("ACCELEROMETER_UNAVAILABLE", "This device does not provide accelerometer data.", null)
            return
        }
        accelerometerSink = events
        sensorManager?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
    }

    override fun onCancel(arguments: Any?) {
        sensorManager?.unregisterListener(this)
        accelerometerSink = null
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != Sensor.TYPE_ACCELEROMETER) return
        accelerometerSink?.success(
            mapOf(
                "x" to event.values[0].toDouble(),
                "y" to event.values[1].toDouble(),
                "z" to event.values[2].toDouble(),
                "timestampMs" to System.currentTimeMillis(),
            ),
        )
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        sensorManager?.unregisterListener(this)
        accelerometerSink = null
        methodChannel.setMethodCallHandler(null)
        accelerometerChannel.setStreamHandler(null)
        transportControlChannel.setStreamHandler(null)
    }
}

private class TransportControlStreamHandler : EventChannel.StreamHandler {
    override fun onListen(arguments: Any?, events: EventChannel.EventSink?) = Unit

    override fun onCancel(arguments: Any?) = Unit
}
