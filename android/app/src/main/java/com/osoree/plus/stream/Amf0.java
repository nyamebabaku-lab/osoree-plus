package com.osoree.plus.stream;

import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** The small part of AMF0 that RTMP commands use: numbers, booleans, strings, null, objects and ECMA arrays. */
final class Amf0 {
    private Amf0() {}

    static byte[] encode(Object... values) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        for (Object v : values) write(out, v, false);
        return out.toByteArray();
    }

    /** An ECMA array (used for onMetaData). */
    static final class Ecma extends LinkedHashMap<String, Object> {}

    @SuppressWarnings("unchecked")
    private static void write(ByteArrayOutputStream out, Object v, boolean inObject) {
        if (v == null) { out.write(0x05); return; }
        if (v instanceof Number) {
            out.write(0x00);
            long bits = Double.doubleToLongBits(((Number) v).doubleValue());
            for (int i = 7; i >= 0; i--) out.write((int) (bits >>> (i * 8)) & 0xff);
            return;
        }
        if (v instanceof Boolean) { out.write(0x01); out.write((Boolean) v ? 1 : 0); return; }
        if (v instanceof String) { out.write(0x02); writeUtf(out, (String) v); return; }
        if (v instanceof Map) {
            Map<String, Object> m = (Map<String, Object>) v;
            if (v instanceof Ecma) {
                out.write(0x08);
                int n = m.size();
                out.write(n >>> 24); out.write(n >>> 16); out.write(n >>> 8); out.write(n);
            } else out.write(0x03);
            for (Map.Entry<String, Object> e : m.entrySet()) { writeUtf(out, e.getKey()); write(out, e.getValue(), true); }
            out.write(0); out.write(0); out.write(0x09);
            return;
        }
        throw new IllegalArgumentException("AMF0: cannot write " + v.getClass());
    }

    private static void writeUtf(ByteArrayOutputStream out, String s) {
        byte[] b = s.getBytes(StandardCharsets.UTF_8);
        out.write(b.length >>> 8); out.write(b.length);
        out.write(b, 0, b.length);
    }

    /** Reads every value in a command message; objects become maps. Unknown types end the list. */
    static List<Object> decode(byte[] d) {
        List<Object> out = new ArrayList<>();
        int[] pos = { 0 };
        try { while (pos[0] < d.length) out.add(read(d, pos)); } catch (RuntimeException e) { /* keep what was read */ }
        return out;
    }

    private static Object read(byte[] d, int[] p) {
        int type = d[p[0]++] & 0xff;
        switch (type) {
            case 0x00: {
                long bits = 0;
                for (int i = 0; i < 8; i++) bits = (bits << 8) | (d[p[0]++] & 0xff);
                return Double.longBitsToDouble(bits);
            }
            case 0x01: return d[p[0]++] != 0;
            case 0x02: return readUtf(d, p);
            case 0x05: case 0x06: return null;
            case 0x08: p[0] += 4; // fall through: an ECMA array is an object with a count in front
            case 0x03: {
                Map<String, Object> m = new LinkedHashMap<>();
                while (true) {
                    String k = readUtf(d, p);
                    if (k.isEmpty() && (d[p[0]] & 0xff) == 0x09) { p[0]++; return m; }
                    m.put(k, read(d, p));
                }
            }
            default: throw new IllegalStateException("AMF0 type " + type);
        }
    }

    private static String readUtf(byte[] d, int[] p) {
        int n = ((d[p[0]] & 0xff) << 8) | (d[p[0] + 1] & 0xff);
        p[0] += 2;
        String s = new String(d, p[0], n, StandardCharsets.UTF_8);
        p[0] += n;
        return s;
    }
}
