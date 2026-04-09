/* Minimal WebHID typings for TypeScript */
interface HIDDevice {
  opened: boolean;
  productName?: string;
  open(): Promise<void>;
  close(): Promise<void>;
  sendReport(reportId: number, data: BufferSource): Promise<void>;
  addEventListener(type: 'inputreport', listener: (event: HIDInputReportEvent) => void): void;
  removeEventListener(type: 'inputreport', listener: (event: HIDInputReportEvent) => void): void;
}

interface HIDInputReportEvent extends Event {
  data: DataView;
  device: HIDDevice;
  reportId: number;
}

interface HIDConnectionEvent extends Event {
  device: HIDDevice;
}

interface HID {
  requestDevice(options?: {
    filters?: Array<{
      vendorId?: number;
      productId?: number;
      usagePage?: number;
      usage?: number;
    }>;
  }): Promise<HIDDevice[]>;
  addEventListener(type: 'disconnect', listener: (event: HIDConnectionEvent) => void): void;
  removeEventListener(type: 'disconnect', listener: (event: HIDConnectionEvent) => void): void;
}

interface Navigator {
  hid?: HID;
}
