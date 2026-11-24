//! Minimal base64 (standard alphabet, with padding), so images can cross the IPC boundary without an extra dependency.

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 {
            ALPHABET[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            ALPHABET[n as usize & 63] as char
        } else {
            '='
        });
    }
    out
}

/// Returns None for anything that is not strictly valid padded base64 (whitespace is ignored).
pub fn decode(text: &str) -> Option<Vec<u8>> {
    let bytes: Vec<u8> = text.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if bytes.len() % 4 != 0 {
        return None;
    }
    let quads = bytes.len() / 4;
    let mut out = Vec::with_capacity(quads * 3);
    for (qi, quad) in bytes.chunks(4).enumerate() {
        let mut n: u32 = 0;
        let mut pad = 0;
        for (i, &c) in quad.iter().enumerate() {
            let v = match c {
                b'A'..=b'Z' => c - b'A',
                b'a'..=b'z' => c - b'a' + 26,
                b'0'..=b'9' => c - b'0' + 52,
                b'+' => 62,
                b'/' => 63,
                b'=' if i >= 2 && qi + 1 == quads => {
                    pad += 1;
                    0
                }
                _ => return None,
            };
            if pad > 0 && c != b'=' {
                return None; // data after padding
            }
            n = (n << 6) | u32::from(v);
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_vectors() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"M"), "TQ==");
        assert_eq!(encode(b"Ma"), "TWE=");
        assert_eq!(encode(b"Man"), "TWFu");
        assert_eq!(decode("TWFu").unwrap(), b"Man");
        assert_eq!(decode("TWE=").unwrap(), b"Ma");
        assert_eq!(decode("TQ==").unwrap(), b"M");
    }

    #[test]
    fn round_trips_every_length() {
        for len in 0..40usize {
            let data: Vec<u8> = (0..len).map(|i| (i * 37 + 11) as u8).collect();
            assert_eq!(decode(&encode(&data)).unwrap(), data, "length {len}");
        }
    }

    #[test]
    fn rejects_malformed_input() {
        for bad in [
            "TWF", "TW=u", "T===", "TWFu====", "TW*u", "=WFu", "TQ==TWFu",
        ] {
            assert!(decode(bad).is_none(), "{bad}");
        }
        assert_eq!(decode("TW Fu\n").unwrap(), b"Man"); // whitespace is fine
    }
}
