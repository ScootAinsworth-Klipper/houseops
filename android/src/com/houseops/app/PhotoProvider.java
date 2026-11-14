package com.scoot.houseops;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;

public class PhotoProvider extends ContentProvider {
    public static final String AUTHORITY = "com.scoot.houseops.photoprovider";

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (getContext() == null) throw new FileNotFoundException("Context is null");
        File file = new File(getContext().getCacheDir(), "camera_capture.jpg");
        if (!file.exists()) {
            try {
                file.createNewFile();
            } catch (IOException e) {
                throw new FileNotFoundException("Could not create camera file: " + e.getMessage());
            }
        }
        int pfdMode = ParcelFileDescriptor.parseMode(mode);
        return ParcelFileDescriptor.open(file, pfdMode);
    }

    @Override
    public String getType(Uri uri) {
        return "image/jpeg";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        MatrixCursor cursor = new MatrixCursor(new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE});
        if (getContext() != null) {
            File file = new File(getContext().getCacheDir(), "camera_capture.jpg");
            cursor.addRow(new Object[]{"camera_capture.jpg", file.exists() ? file.length() : 0L});
        }
        return cursor;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) { return null; }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) { return 0; }
}
