import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppointmentDialog from "./AppointmentDialog";

global.IS_REACT_ACT_ENVIRONMENT = true;

// Capture update payloads without jest.fn — CRA resetMocks clears fn implementations.
let lastUpdateArgs = null;

const appointment = {
  id: "apt-1",
  studio_id: "studio-1",
  artist_id: "artist-1",
  location_id: "loc-1",
  work_station_id: "",
  customer_id: "",
  appointment_type_id: "type-1",
  client_name: "Pat Client",
  client_email: "pat@example.com",
  client_phone: "",
  appointment_date: "2026-08-10",
  start_time: "12:00",
  end_time: "14:00",
  is_all_day: false,
  deposit_amount: 0,
  total_estimate: 0,
  tax_amount: 0,
  design_description: "",
  placement: "",
  appointment_name: "KEEP TATTOOS OPEN",
  notes: "",
  status: "scheduled",
  deposit_status: "none",
};

const artists = [
  {
    id: "artist-1",
    name: "Alex Artist",
    is_active: true,
    primary_location_id: "loc-1",
    preferred_work_station_id: "ws-1",
  },
];

const locations = [
  { id: "loc-1", name: "Main Studio", is_active: true, created_at: "2026-01-01" },
];

const currentUser = {
  id: "user-1",
  studio_id: "studio-1",
  role: "Admin",
};

jest.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Appointment: {
        filter: async () => [],
        update: async (id, data) => {
          lastUpdateArgs = { id, data };
          return { ...appointment, ...data, id };
        },
        create: async () => ({}),
      },
      AppointmentType: {
        filter: async () => [
          { id: "type-1", name: "Tattoo", is_active: true, duration_minutes: 120 },
        ],
      },
      ReportingCategory: { filter: async () => [] },
      WorkStation: { filter: async () => [] },
      Availability: { filter: async () => [] },
      ArtistWeeklySchedule: { filter: async () => [] },
      ArtistAppointmentTypeExclusion: { filter: async () => [] },
      Studio: { filter: async () => [{ id: "studio-1" }] },
      Sale: { filter: async () => [] },
      SaleLineItem: { filter: async () => [] },
      AppointmentCharge: { filter: async () => [] },
      Customer: { filter: async () => [] },
      ReportingTenderGroup: { filter: async () => [] },
    },
  },
}));

jest.mock("@/utils/supabase", () => ({
  supabase: { functions: { invoke: async () => ({ data: null, error: null }) } },
}));
jest.mock("@/utils/useCheckoutPaymentMethods", () => ({
  useCheckoutPaymentMethods: () => ({
    options: [
      { value: "Cash", label: "Cash" },
      { value: "Card", label: "Card" },
    ],
    values: ["Cash", "Card"],
    customMethods: [],
  }),
}));
jest.mock("../customers/CustomerSearch", () => () => null);
jest.mock("../customers/CustomerDialog", () => () => null);
jest.mock("../customers/AdvancedSearchDialog", () => () => null);
jest.mock("./CheckoutDialog", () => () => null);
jest.mock("./RefundDialog", () => () => null);
jest.mock("./TimePicker12h", () => () => null);

jest.mock("@/components/ui/select", () => {
  const Passthrough = ({ children }) => <div>{children}</div>;
  return {
    Select: Passthrough,
    SelectContent: Passthrough,
    SelectGroup: Passthrough,
    SelectItem: ({ children }) => <div>{children}</div>,
    SelectLabel: Passthrough,
    SelectSeparator: () => null,
    SelectTrigger: Passthrough,
    SelectValue: () => null,
  };
});

jest.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }) => <div>{children}</div>,
  DialogHeader: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
  DialogDescription: ({ children }) => <p>{children}</p>,
  DialogFooter: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/accordion", () => ({
  Accordion: ({ children }) => <div>{children}</div>,
  AccordionItem: ({ children }) => <div>{children}</div>,
  AccordionTrigger: ({ children }) => <div>{children}</div>,
  AccordionContent: ({ children }) => <div>{children}</div>,
}));

jest.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, id, disabled }) => (
    <input
      id={id}
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

jest.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked, onCheckedChange, id, disabled }) => (
    <input
      id={id}
      type="checkbox"
      checked={!!checked}
      disabled={disabled}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

async function flushQueries() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("AppointmentDialog cancel", () => {
  let container;
  let root;
  let client;
  let confirmSpy;

  beforeEach(() => {
    lastUpdateArgs = null;
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    confirmSpy.mockRestore();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    client.clear();
  });

  it("cancels with status only so empty UUID form fields are not sent", async () => {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <AppointmentDialog
            open
            onOpenChange={() => {}}
            appointment={appointment}
            artists={artists}
            locations={locations}
            currentUser={currentUser}
            userArtist={null}
          />
        </QueryClientProvider>
      );
    });

    await flushQueries();

    const cancelButton = Array.from(container.querySelectorAll("button")).find((btn) =>
      btn.textContent.includes("Cancel Appointment")
    );
    expect(cancelButton).toBeTruthy();

    await act(async () => {
      cancelButton.click();
    });

    await flushQueries();

    expect(lastUpdateArgs).toEqual({
      id: "apt-1",
      data: { status: "cancelled" },
    });
    expect(lastUpdateArgs.data.customer_id).toBeUndefined();
    expect(lastUpdateArgs.data.work_station_id).toBeUndefined();
  });
});
