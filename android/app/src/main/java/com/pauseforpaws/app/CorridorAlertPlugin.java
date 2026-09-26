package com.pauseforpaws.app;

import android.Manifest;
import android.content.Intent;
import android.media.AudioAttributes;
import android.os.Build;
import android.speech.tts.TextToSpeech;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

// Bridges the JS UI to the native background corridor-alert foreground service.
@CapacitorPlugin(
    name = "CorridorAlert",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class CorridorAlertPlugin extends Plugin {

    /** Plays a real alert on demand so a driver can check car-audio volume before setting off,
     *  and a store reviewer can hear the feature without standing next to an Iowa corridor.
     *  Uses its own TextToSpeech rather than the service's, so it works even when alerts are
     *  switched off and the service is not running. */
    private static final String TEST_TEXT =
            "Pause for Paws. This is a test alert. Wildlife crossing ahead. Watch both shoulders.";
    private TextToSpeech testTts;

    @PluginMethod
    public void test(PluginCall call) {
        if (testTts == null) {
            testTts = new TextToSpeech(getContext(), status -> {
                if (status == TextToSpeech.SUCCESS) {
                    testTts.setAudioAttributes(new AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build());
                    testTts.speak(TEST_TEXT, TextToSpeech.QUEUE_FLUSH, null, "corridor-test");
                }
            });
        } else {
            testTts.speak(TEST_TEXT, TextToSpeech.QUEUE_FLUSH, null, "corridor-test");
        }
        JSObject result = new JSObject();
        result.put("played", true);
        call.resolve(result);
    }

    @Override
    protected void handleOnDestroy() {
        if (testTts != null) {
            testTts.stop();
            testTts.shutdown();
            testTts = null;
        }
        super.handleOnDestroy();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationCallback");
            return;
        }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "notificationCallback");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void locationCallback(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) {
            start(call);
        } else {
            call.reject("Location permission is required for corridor alerts.");
        }
    }

    @PermissionCallback
    private void notificationCallback(PluginCall call) {
        start(call);
    }

    private void startService(PluginCall call) {
        Intent intent = new Intent(getContext(), CorridorAlertService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(intent);
        } else {
            getContext().startService(intent);
        }
        JSObject result = new JSObject();
        result.put("running", true);
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), CorridorAlertService.class);
        getContext().stopService(intent);
        JSObject result = new JSObject();
        result.put("running", false);
        call.resolve(result);
    }
}
