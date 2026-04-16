import si from 'systeminformation'
import type { KnowledgeInput } from '../shared/types.js'
import { childLogger } from '../shared/logger.js'

const log = childLogger('agent:system')

export async function collectSystemInfo(): Promise<KnowledgeInput[]> {
  log.info('Collecting system information')
  const items: KnowledgeInput[] = []

  const [cpu, mem, osInfo, load, disks, graphics, battery, temp, processes] = await Promise.allSettled([
    si.cpu(),
    si.mem(),
    si.osInfo(),
    si.currentLoad(),
    si.diskLayout(),
    si.graphics(),
    si.battery(),
    si.cpuTemperature(),
    si.processes(),
  ])

  if (cpu.status === 'fulfilled') {
    const c = cpu.value
    items.push({
      title: `CPU: ${c.manufacturer} ${c.brand}`,
      content: `CPU: ${c.manufacturer} ${c.brand}, ${c.cores} cores (${c.physicalCores} physical), Speed: ${c.speed}GHz, Max: ${c.speedMax}GHz, Cache: L1=${c.cache.l1d}KB L2=${c.cache.l2}KB L3=${c.cache.l3}KB`,
      category: 'hardware',
      source: 'system-agent',
      metadata: { ...c },
      importance_score: 0.8,
    })
  }

  if (mem.status === 'fulfilled') {
    const m = mem.value
    const totalGb = (m.total / 1024 ** 3).toFixed(2)
    const usedGb = (m.used / 1024 ** 3).toFixed(2)
    const freeGb = (m.free / 1024 ** 3).toFixed(2)
    items.push({
      title: 'Memory Usage',
      content: `RAM: Total=${totalGb}GB, Used=${usedGb}GB, Free=${freeGb}GB, Usage=${((m.used / m.total) * 100).toFixed(1)}%`,
      category: 'hardware',
      source: 'system-agent',
      metadata: { totalGb, usedGb, freeGb },
      importance_score: 0.6,
    })
  }

  if (osInfo.status === 'fulfilled') {
    const o = osInfo.value
    items.push({
      title: `OS: ${o.distro} ${o.release}`,
      content: `Platform: ${o.platform}, Distro: ${o.distro}, Release: ${o.release}, Kernel: ${o.kernel}, Arch: ${o.arch}, Hostname: ${o.hostname}`,
      category: 'system-info',
      source: 'system-agent',
      metadata: { ...o },
      importance_score: 0.9,
    })
  }

  if (load.status === 'fulfilled') {
    const l = load.value
    items.push({
      title: 'Current CPU Load',
      content: `CPU Load: ${l.currentLoad.toFixed(1)}%, User: ${l.currentLoadUser.toFixed(1)}%, System: ${l.currentLoadSystem.toFixed(1)}%`,
      category: 'performance',
      source: 'system-agent',
      metadata: { load: l.currentLoad },
      importance_score: 0.4,
    })
  }

  if (disks.status === 'fulfilled') {
    const d = disks.value
    d.forEach((disk, i) => {
      items.push({
        title: `Disk ${i + 1}: ${disk.name}`,
        content: `Disk: ${disk.name}, Type: ${disk.type}, Size: ${(disk.size / 1024 ** 3).toFixed(0)}GB, Interface: ${disk.interfaceType}, Vendor: ${disk.vendor}`,
        category: 'hardware',
        source: 'system-agent',
        metadata: { ...disk },
        importance_score: 0.7,
      })
    })
  }

  if (graphics.status === 'fulfilled') {
    graphics.value.controllers.forEach((g, i) => {
      items.push({
        title: `GPU ${i + 1}: ${g.vendor} ${g.model}`,
        content: `GPU: ${g.vendor} ${g.model}, VRAM: ${g.vram}MB, Driver: ${g.driverVersion}, Bus: ${g.bus}`,
        category: 'hardware',
        source: 'system-agent',
        metadata: { ...g },
        importance_score: 0.7,
      })
    })
  }

  if (battery.status === 'fulfilled' && battery.value.hasBattery) {
    const b = battery.value
    items.push({
      title: 'Battery Status',
      content: `Battery: ${b.percent}% charged, ${b.isCharging ? 'Charging' : 'Discharging'}, Voltage: ${b.voltage}V`,
      category: 'hardware',
      source: 'system-agent',
      metadata: { ...b },
      importance_score: 0.5,
    })
  }

  if (temp.status === 'fulfilled' && temp.value.main !== -1) {
    items.push({
      title: 'CPU Temperature',
      content: `CPU Temperature: ${temp.value.main}°C (max: ${temp.value.max}°C)`,
      category: 'performance',
      source: 'system-agent',
      metadata: { main: temp.value.main, max: temp.value.max },
      importance_score: 0.5,
    })
  }

  if (processes.status === 'fulfilled') {
    const p = processes.value
    items.push({
      title: 'Running Processes',
      content: `Total processes: ${p.all}, Running: ${p.running}, Sleeping: ${p.sleeping}, Blocked: ${p.blocked}`,
      category: 'system-info',
      source: 'system-agent',
      metadata: { all: p.all, running: p.running },
      importance_score: 0.3,
    })
  }

  log.info({ count: items.length }, 'System info collected')
  return items
}
