package ma.syndicunion.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static final String ALERTS_CHANNEL_ID = "syndik_alerts";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        ensureNotificationChannel();
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        if (manager.getNotificationChannel(ALERTS_CHANNEL_ID) == null) {
            NotificationChannel channel = new NotificationChannel(
                ALERTS_CHANNEL_ID,
                "Alertes SyndicUnion",
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription("Charges, justificatifs, assemblées générales et notifications de copropriété.");
            channel.enableVibration(true);
            channel.enableLights(true);
            manager.createNotificationChannel(channel);
        }
    }
}
