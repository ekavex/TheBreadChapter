import { describe, expect, it, vi } from 'vitest'

// The RFCOMM bind used to run through a shell with an admin-editable MAC in the
// command string. These tests pin the two guards that replaced it.
const execFile = vi.fn((_cmd: string, _args: string[], cb: (e: Error | null) => void) => cb(null))
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => (execFile as never as (...a: unknown[]) => void)(...args) }))

import { BluetoothPrinterService } from '@/lib/printer/BluetoothPrinterService'

const ticket = {
  tableNumber: 4,
  orderId: 'order-1',
  station: 'kitchen' as const,
  items: [{ name: 'Flat White', quantity: 1 }],
}

describe('bluetooth printer bind safety', () => {
  it('refuses a MAC carrying shell metacharacters', async () => {
    const svc = new BluetoothPrinterService({
      kitchen: { device: '/dev/rfcomm0', mac: 'AA:BB:CC:DD:EE:FF; rm -rf /' },
    })
    await expect(svc.printTicket(ticket)).rejects.toThrow(/invalid Bluetooth MAC/)
    expect(execFile).not.toHaveBeenCalled()
  })

  it('refuses a device path outside /dev/rfcommN', async () => {
    const svc = new BluetoothPrinterService({
      kitchen: { device: '/dev/rfcomm0/../../etc/passwd', mac: 'AA:BB:CC:DD:EE:FF' },
    })
    await expect(svc.printTicket(ticket)).rejects.toThrow(/unexpected device path/)
    expect(execFile).not.toHaveBeenCalled()
  })
})
