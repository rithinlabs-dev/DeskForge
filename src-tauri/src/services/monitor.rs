use super::{SystemMonitor, SystemSnapshot};
use parking_lot::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use sysinfo::{Networks, System};

pub struct SysinfoMonitor {
    sys: Mutex<System>,
    nets: Mutex<Networks>,
}

impl SysinfoMonitor {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_usage();
        sys.refresh_memory();
        Self {
            sys: Mutex::new(sys),
            nets: Mutex::new(Networks::new_with_refreshed_list()),
        }
    }
}

impl SystemMonitor for SysinfoMonitor {
    fn snapshot(&self) -> SystemSnapshot {
        let (cpu, used, total) = {
            let mut sys = self.sys.lock();
            sys.refresh_cpu_usage();
            sys.refresh_memory();
            (
                sys.global_cpu_usage(),
                sys.used_memory(),
                sys.total_memory(),
            )
        };
        let (rx, tx) = {
            let mut nets = self.nets.lock();
            nets.refresh(true);
            nets.iter().fold((0u64, 0u64), |(r, t), (_, n)| {
                (r + n.received(), t + n.transmitted())
            })
        };
        SystemSnapshot {
            timestamp_ms: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0),
            cpu_percent: cpu,
            mem_used: used,
            mem_total: total,
            net_rx_bytes: rx,
            net_tx_bytes: tx,
        }
    }
}
