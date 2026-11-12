package com.osoree.plus.stream;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

/** H.264 helpers: encoder output (Annex B, with start codes) → what RTMP/FLV carries (avcC + length-prefixed NAL units). */
public final class Avc {
    private Avc() {}

    /** NAL units without their start codes. */
    public static List<byte[]> split(byte[] d, int off, int len) {
        List<byte[]> nals = new ArrayList<>();
        int end = off + len, i = off, start = -1;
        while (i + 3 <= end) {
            boolean three = d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 1;
            boolean four = i + 4 <= end && d[i] == 0 && d[i + 1] == 0 && d[i + 2] == 0 && d[i + 3] == 1;
            if (three || four) {
                if (start >= 0) nals.add(trimmed(d, start, i));
                i += four ? 4 : 3;
                start = i;
            } else i++;
        }
        if (start >= 0 && start < end) nals.add(trimmed(d, start, end));
        if (start < 0 && len > 0) { byte[] all = new byte[len]; System.arraycopy(d, off, all, 0, len); nals.add(all); }
        return nals;
    }

    private static byte[] trimmed(byte[] d, int from, int to) {
        while (to > from && d[to - 1] == 0) to--; // trailing zero bytes belong to the next start code
        byte[] n = new byte[to - from];
        System.arraycopy(d, from, n, 0, n.length);
        return n;
    }

    public static int type(byte[] nal) { return nal.length > 0 ? nal[0] & 0x1f : -1; }

    /** AVCDecoderConfigurationRecord from one SPS and one PPS. */
    public static byte[] avcC(byte[] sps, byte[] pps) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        o.write(1); o.write(sps[1]); o.write(sps[2]); o.write(sps[3]);
        o.write(0xff); // 4-byte NAL lengths
        o.write(0xe1); // one SPS
        o.write(sps.length >>> 8); o.write(sps.length); o.write(sps, 0, sps.length);
        o.write(1);    // one PPS
        o.write(pps.length >>> 8); o.write(pps.length); o.write(pps, 0, pps.length);
        return o.toByteArray();
    }

    /** Picture NAL units with 4-byte lengths, leaving out parameter sets and delimiters (sent once in avcC). */
    public static byte[] lengthPrefixed(List<byte[]> nals) {
        ByteArrayOutputStream o = new ByteArrayOutputStream();
        for (byte[] n : nals) {
            int t = type(n);
            if (t == 7 || t == 8 || t == 9 || n.length == 0) continue;
            o.write(n.length >>> 24); o.write(n.length >>> 16); o.write(n.length >>> 8); o.write(n.length);
            o.write(n, 0, n.length);
        }
        return o.toByteArray();
    }
}
