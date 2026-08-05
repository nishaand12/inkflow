import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AppointmentDialog from "./AppointmentDialog";

global.IS_REACT_ACT_ENVIRONMENT = true;

const appointment = {
  id: "apt-1",
  studio_id: "studio-1",
  artist_id: "artist-1",
  location_id: "loc-1",
  work_station_id: "ws-1",
  customer_id: "",
  appointment_type_id: "type-1",
  client_name: "Pat Client",
  client_email: "pat@example.com",
  client_phone: "",
  appointment_date: "2026-08-10",
  start_time: "12:00",
  end_time: "14:00",
  is_all_day: false,
  deposit_amount: 50,
  total_estimate: 200,
  tax_amount: 0,
  design_description: "",
  placement: "",
  appointment_name: "Session",
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

// Plain functions (not jest.fn): CRA's resetMocks strips jest.fn implementations
// before each test, which would leave these returning undefined.
jest.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Appointment: {
        filter: async ({ appointment_date }) => {
          // Original day includes the appointment being edited. The newly
          // selected day does not — that identity flip is what used to re-run
          // the form reset effect and wipe the date field.
          if (appointment_date === "2026-08-10") {
            return [
              {
                id: "apt-1",
                studio_id: "studio-1",
                artist_id: "artist-1",
                location_id: "loc-1",
                work_station_id: "ws-1",
                customer_id: "",
                appointment_type_id: "type-1",
                client_name: "Pat Client",
                client_email: "pat@example.com",
                client_phone: "",
                appointment_date: "2026-08-10",
                start_time: "12:00",
                end_time: "14:00",
                is_all_day: false,
                deposit_amount: 50,
                total_estimate: 200,
                tax_amount: 0,
                design_description: "",
                placement: "",
                appointment_name: "Session",
                notes: "",
                status: "scheduled",
                deposit_status: "none",
              },
            ];
          }
          return [];
        },
        update: async () => ({}),
        create: async () => ({}),
      },
      AppointmentType: {
        filter: async () => [
          { id: "type-1", name: "Tattoo", is_active: true, duration_minutes: 120 },
        ],
      },
      ReportingCategory: { filter: async () => [] },
      WorkStation: {
        filter: async () => [
          {
            id: "ws-1",
            location_id: "loc-1",
            name: "Station 1",
            status: "active",
            created_at: "2026-01-01",
          },
        ],
      },
      Availability: { filter: async () => [] },
      ArtistWeeklySchedule: { filter: async () => [] },
      ArtistAppointmentTypeExclusion: { filter: async () => [] },
      Studio: { filter: async () => [{ id: "studio-1" }] },
      Sale: { filter: async () => [] },
      SaleLineItem: { filter: async () => [] },
      AppointmentCharge: { filter: async () => [] },
      Customer: { filter: async () => [] },
    },
  },
}));

jest.mock("@/utils/supabase", () => ({
  supabase: { functions: { invoke: async () => ({ data: null, error: null }) } },
}));
jest.mock("@/utils/useCheckoutPaymentMethods", () => ({
  useCheckoutPaymentMethods: () => ({ methods: ["Cash", "Card"], loading: false }),
}));

jest.mock("../customers/CustomerSearch", () => () => null);
jest.mock("../customers/CustomerDialog", () => () => null);
jest.mock("../customers/AdvancedSearchDialog", () => () => null);
jest.mock("./CheckoutDialog", () => () => null);
jest.mock("./RefundDialog", () => () => null);
jest.mock("./TimePicker12h", () => (props) => (
  <input
    data-testid={props.id || "time-picker"}
    value={props.value || ""}
    onChange={(e) => props.onChange?.(e.target.value)}
    disabled={props.disabled}
  />
));

// Radix Select is awkward under jsdom; the date field under test is a native input.
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

async function flushQueries() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("AppointmentDialog date editing", () => {
  let container;
  let root;
  let client;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    client.clear();
  });

  it("keeps a newly selected date after the conflict query for that day resolves", async () => {
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

    // Let the original-date conflict query settle so appointmentForForm is the
    // cached row — the state that used to make the next date change fatal.
    await flushQueries();

    const dateInput = container.querySelector('input[type="date"]');
    expect(dateInput).toBeTruthy();
    expect(dateInput.value).toBe("2026-08-10");

    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(dateInput, "2026-08-12");
      dateInput.dispatchEvent(new Event("input", { bubbles: true }));
      dateInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(dateInput.value).toBe("2026-08-12");

    // New-day query resolves without this appointment. Previously that flipped
    // appointmentForForm back to the prop and the reset effect restored 08-10.
    await flushQueries();

    expect(container.querySelector('input[type="date"]').value).toBe("2026-08-12");
  });
});
