package com.pauseforpaws.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

// Foreground service: shows the ongoing "monitoring" notification Android requires and speaks a
// short alert when the driver enters a bundled historical wildlife-collision corridor, so it reaches
// them over Bluetooth / Android Auto car audio. Voice only, by design. Mirrors iOS CorridorAlertMonitor.
public class CorridorAlertService extends Service implements LocationListener {
    public static final String CHANNEL_MONITOR = "pause_for_paws_monitor";
    private static final int MONITOR_NOTIFICATION_ID = 1001;
    private static final double ALERT_RADIUS_MILES = 2.0;
    private static final double EXIT_RADIUS_MILES = 3.0;         // re-arm a zone only once clearly past it
    private static final long ALERT_SPACING_MS = 2 * 60 * 1000;  // between any two alerts
    private static final float MIN_DRIVING_SPEED_MPS = 8.9f;     // about 20 mph

    private LocationManager locationManager;
    private final List<Corridor> corridors = new ArrayList<>();
    private final Set<String> insideCorridorIds = new HashSet<>();
    private long lastAlertAt = 0;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private AudioFocusRequest focusRequest;

    private static class Corridor {
        String id;
        String species; // "animal-crash" for DOT clusters, or a real animal for reported crossings
        double lat;
        double lng;

        // Driver-facing wording for the spoken alert, kept to one breath so it never competes with the road.
        String animal() {
            String s = species == null ? "" : species.trim().toLowerCase(Locale.US);
            if (s.isEmpty() || s.equals("animal-crash") || s.equals("animal-related crashes") || s.equals("wildlife")) return null;
            return species.trim();
        }
        String headline() { return (animal() == null ? "Wildlife" : animal()) + " crossing ahead"; }
        String advice() { return animal() == null ? "Watch for deer." : "Watch both sides."; }
        String speech() { return "Pause for Paws. " + headline() + ". " + advice(); }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        loadCorridors();
        startAsForeground();
        startLocationUpdates();
        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                tts.setAudioAttributes(speechAttributes());
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override public void onStart(String utteranceId) { }
                    @Override public void onDone(String utteranceId) { abandonAudioFocus(); }
                    @Override public void onError(String utteranceId) { abandonAudioFocus(); }
                });
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(this);
            } catch (SecurityException ignored) {
            }
        }
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            NotificationChannel monitor = new NotificationChannel(CHANNEL_MONITOR, "Pause for Paws monitoring", NotificationManager.IMPORTANCE_LOW);
            monitor.setDescription("Shows when background corridor monitoring is active.");
            if (manager != null) {
                manager.createNotificationChannel(monitor);
            }
        }
    }

    private void loadCorridors() {
        try (InputStream stream = getAssets().open("public/data/corridors.json")) {
            BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
            StringBuilder builder = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) builder.append(line);
            JSONObject feed = new JSONObject(builder.toString());
            JSONArray events = feed.optJSONArray("events");
            if (events == null) return;
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i);
                Corridor corridor = new Corridor();
                corridor.id = event.optString("id", "corridor-" + i);
                corridor.species = event.optString("species", "");
                corridor.lat = event.optDouble("lat");
                corridor.lng = event.optDouble("lng");
                if (Double.isNaN(corridor.lat) || Double.isNaN(corridor.lng)) continue;
                corridors.add(corridor);
            }
        } catch (Exception ignored) {
            // No bundled feed available; the service still runs with zero zones to compare.
        }
    }

    private void startAsForeground() {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_IMMUTABLE : 0);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_MONITOR)
                .setContentTitle("Pause for Paws")
                .setContentText("Monitoring for historical wildlife corridors")
                .setSmallIcon(android.R.drawable.ic_menu_mylocation)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(MONITOR_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(MONITOR_NOTIFICATION_ID, notification);
        }
    }

    private void startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) {
            stopSelf();
            return;
        }
        boolean hasFine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean hasCoarse = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        if (!hasFine && !hasCoarse) {
            stopSelf();
            return;
        }
        try {
            locationManager.requestLocationUpdates(LocationManager.GPS_PROVIDER, 60000, 200, this);
            locationManager.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 60000, 200, this);
        } catch (SecurityException | IllegalArgumentException ignored) {
        }
    }

    @Override
    public void onLocationChanged(Location location) {
        Corridor nearest = null;
        double nearestDistance = ALERT_RADIUS_MILES;
        List<Corridor> inRange = new ArrayList<>();
        for (Corridor corridor : corridors) {
            double distance = distanceMiles(location.getLatitude(), location.getLongitude(), corridor.lat, corridor.lng);
            // Leaving a zone re-arms it for the next pass; 3 mi out vs 2 mi in absorbs GPS jitter.
            if (distance > EXIT_RADIUS_MILES) insideCorridorIds.remove(corridor.id);
            if (distance > ALERT_RADIUS_MILES) continue;
            inRange.add(corridor);
            // Corridors overlap; only the nearest zone we have not already announced gets to speak.
            if (!insideCorridorIds.contains(corridor.id) && distance <= nearestDistance) {
                nearest = corridor;
                nearestDistance = distance;
            }
        }
        // Parked or walking inside a zone is not a reason to alert; unknown speed passes.
        if (location.hasSpeed() && location.getSpeed() < MIN_DRIVING_SPEED_MPS) return;
        if (nearest == null) return;
        long now = System.currentTimeMillis();
        if (now - lastAlertAt < ALERT_SPACING_MS) return;
        lastAlertAt = now;
        // One alert covers every overlapping zone the driver is in right now.
        for (Corridor corridor : inRange) insideCorridorIds.add(corridor.id);
        speak(nearest.speech());
    }

    // Spoken alert: ducks music / navigation while speaking, like a turn-by-turn prompt.
    private void speak(String text) {
        if (!ttsReady || tts == null) return;
        AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audioManager != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(speechAttributes())
                        .build();
                audioManager.requestAudioFocus(focusRequest);
            } else {
                audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
            }
        }
        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "corridor-alert");
    }

    private void abandonAudioFocus() {
        AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        if (audioManager == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
        } else {
            audioManager.abandonAudioFocus(null);
        }
    }

    private static AudioAttributes speechAttributes() {
        return new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
    }

    @Override
    public void onStatusChanged(String provider, int status, Bundle extras) {
    }

    @Override
    public void onProviderEnabled(String provider) {
    }

    @Override
    public void onProviderDisabled(String provider) {
    }

    private static double distanceMiles(double lat1, double lng1, double lat2, double lng2) {
        double radians = Math.PI / 180;
        double dLat = (lat2 - lat1) * radians;
        double dLng = (lng2 - lng1) * radians;
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        double c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return 3958.8 * c;
    }
}
