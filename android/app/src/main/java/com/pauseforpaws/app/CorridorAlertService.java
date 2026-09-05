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
import java.util.HashMap;
import java.util.List;
import java.util.Map;

// Foreground service: shows an ongoing "monitoring" notification and pops up an alert
// when the device is near a bundled historical wildlife-collision corridor.
public class CorridorAlertService extends Service implements LocationListener {
    public static final String CHANNEL_MONITOR = "pause_for_paws_monitor";
    public static final String CHANNEL_ALERT = "pause_for_paws_alert";
    private static final int MONITOR_NOTIFICATION_ID = 1001;
    private static final double ALERT_RADIUS_MILES = 2.0;
    private static final long ALERT_COOLDOWN_MS = 10 * 60 * 1000;

    private LocationManager locationManager;
    private final List<Corridor> corridors = new ArrayList<>();
    private final Map<String, Long> lastAlertedAt = new HashMap<>();

    private static class Corridor {
        String id;
        String label;
        double lat;
        double lng;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        loadCorridors();
        startAsForeground();
        startLocationUpdates();
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
            NotificationChannel alert = new NotificationChannel(CHANNEL_ALERT, "Pause for Paws corridor alerts", NotificationManager.IMPORTANCE_HIGH);
            alert.setDescription("Historical wildlife-collision corridor alerts.");
            if (manager != null) {
                manager.createNotificationChannel(monitor);
                manager.createNotificationChannel(alert);
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
                corridor.label = event.optString("species", "Historical wildlife corridor");
                corridor.lat = event.optDouble("lat");
                corridor.lng = event.optDouble("lng");
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
        for (Corridor corridor : corridors) {
            double distance = distanceMiles(location.getLatitude(), location.getLongitude(), corridor.lat, corridor.lng);
            if (distance <= ALERT_RADIUS_MILES) maybeAlert(corridor);
        }
    }

    private void maybeAlert(Corridor corridor) {
        long now = System.currentTimeMillis();
        Long last = lastAlertedAt.get(corridor.id);
        if (last != null && now - last < ALERT_COOLDOWN_MS) return;
        lastAlertedAt.put(corridor.id, now);
        showAlert(corridor);
    }

    private void showAlert(Corridor corridor) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, notificationIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_IMMUTABLE : 0);
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ALERT)
                .setContentTitle("Pause for Paws")
                .setContentText("Historical " + corridor.label.toLowerCase() + " corridor ahead. Slow down and watch both shoulders.")
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build();
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && Build.VERSION.SDK_INT >= 33) {
            return;
        }
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(corridor.id.hashCode(), notification);
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
