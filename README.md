# InkFlow

**The Complete Studio Scheduling & Management Platform**

InkFlow is a modern, cloud-based scheduling and management solution designed specifically for tattoo studios, piercing shops, and creative service businesses. Built with React and powered by Supabase, InkFlow streamlines daily operations, enhances team coordination, and provides powerful insights to grow your business.

---

## Why InkFlow?

Running a successful studio means juggling appointments, managing multiple artists, tracking customers, and keeping finances organized—all while delivering exceptional service. InkFlow brings everything together in one intuitive platform:

- **Reduce No-Shows** — Automated email reminders keep clients informed
- **Maximize Bookings** — Visual calendar shows availability at a glance
- **Scale Effortlessly** — Multi-location support for growing businesses
- **Empower Your Team** — Role-based access gives everyone the tools they need
- **Make Data-Driven Decisions** — Comprehensive reports track revenue and performance

---

## Core Features

### Intelligent Appointment Scheduling

- **Visual Calendar** — Day, week, and month views with color-coded appointment statuses
- **Quick Booking** — Create appointments in seconds with smart defaults
- **Status Tracking** — Monitor appointments through their lifecycle: Scheduled → Confirmed → Completed
- **Conflict Prevention** — Workstation and artist availability validation
- **Mobile-Responsive** — Full functionality on phones and tablets for on-the-go management

### Multi-Location Management

- **Unlimited Locations** — Manage all your studio locations from a single dashboard
- **Location-Specific Workstations** — Configure chairs/rooms per location with capacity limits
- **Artist Location Assignment** — Track which artists work at which locations
- **Location-Based Filtering** — View calendar and reports filtered by location

### Artist & Team Management

- **Artist Profiles** — Detailed profiles with specialty, bio, hourly rate, and Instagram
- **Availability Management** — Artists set their own working hours and time-off
- **Multi-Day Availability** — Support for vacation blocks and recurring schedules
- **Primary Location Assignment** — Default location for each artist
- **Performance Tracking** — Revenue and appointment metrics per artist

### Customer Relationship Management

- **Customer Profiles** — Store contact info, Instagram, and preferred location
- **Consent Tracking** — Document consent obtained for compliance
- **Email Status Monitoring** — Track bounces and unsubscribes automatically
- **Search & Filter** — Find customers by name, email, phone, or Instagram
- **Appointment History** — Complete record of each customer's visits

### Appointment Types & Services

- **Customizable Services** — Define your service menu (consultations, sessions, touch-ups, etc.)
- **Default Durations** — Set standard time blocks for each service type
- **Default Deposits** — Configure deposit amounts per service
- **Category Organization** — Group related services together
- **Pricing Flexibility** — Override defaults on individual appointments

### Financial Tracking & Checkout

- **Deposit Management** — Track deposits collected at booking
- **Checkout Flow** — Record final charges, tax, and payment method
- **Payment Methods** — Support for Card, Cash, and E-Transfer
- **Revenue Calculations** — Automatic totals from deposits + charges
- **Estimate vs. Actual** — Compare quoted estimates to final charges

### Comprehensive Reporting

- **Appointments by Type** — See which services are most popular
- **Revenue by Artist** — Track individual artist performance
- **Revenue by Location** — Compare location profitability
- **Revenue by Payment Method** — Understand payment preferences
- **Date Range Filtering** — Analyze any time period
- **CSV Export** — Download reports for external analysis

### Automated Email Communications (Plus Tier)

- **Appointment Confirmations** — Automatic email when appointments are created
- **Update Notifications** — Clients notified when appointments change
- **Smart Reminders** — Configurable reminder timing (1 hour to 1 week before)
- **Calendar Invites** — Optional .ics attachments for client calendars
- **Timezone Support** — Times displayed correctly for your studio's timezone
- **Bounce Handling** — Automatic tracking of undeliverable emails

---

## User Roles & Permissions

InkFlow's role-based system ensures everyone has the right level of access:

| Feature | Owner | Admin | Front Desk | Artist |
|---------|-------|-------|------------|--------|
| View Dashboard | ✓ | ✓ | ✓ | ✓ |
| View Calendar | ✓ | ✓ | ✓ | ✓ (own appointments) |
| Create/Edit Appointments | ✓ | ✓ | ✓ | ✓ |
| Manage Customers | ✓ | ✓ | ✓ | — |
| Manage Artists | ✓ | ✓ | View Only | — |
| Manage Locations | ✓ | ✓ | — | — |
| Manage Workstations | ✓ | ✓ | — | — |
| Manage Appointment Types | ✓ | ✓ | — | — |
| View Reports | ✓ | ✓ | — | — |
| Studio Settings | ✓ | ✓ | — | — |
| My Availability | ✓ | ✓ | — | ✓ |

---

## Getting Started

### For New Studios

1. **Sign Up** — Create your account with email/password
2. **Create Your Studio** — Enter studio name, location, and contact info
3. **Studio Validation** — Contact support to activate your account
4. **Follow the Setup Guide** — The built-in guide walks you through configuration

### Initial Setup Checklist

Setting up InkFlow takes just minutes. Complete these steps in order:

1. **Add a Location** — Enter your physical address and contact info
2. **Create Workstations** — Add the chairs/rooms where appointments happen
3. **Define Appointment Types** — List your services with durations and deposits
4. **Add Artists** — Create profiles for your team (they must sign up first)
5. **Start Booking** — You're ready to schedule your first appointment!

### Inviting Team Members

1. Go to **Studio Settings**
2. Copy your unique **Invite Code**
3. Share with team members
4. They sign up and select "Join Existing Studio"
5. They enter the invite code to join your studio
6. Contact support to assign appropriate roles

---

## Platform Highlights

### Modern, Intuitive Interface

- Clean, professional design built with modern UI principles
- Consistent experience across desktop, tablet, and mobile
- Dark/light mode support for comfortable viewing
- Smooth animations and transitions for a polished feel

### Real-Time Updates

- Instant synchronization across all devices
- No page refreshes needed—changes appear immediately
- Optimistic updates for snappy interactions

### Secure & Reliable

- Built on Supabase with PostgreSQL database
- Row-level security ensures data isolation between studios
- Encrypted authentication with secure session management
- Regular automated backups

### Scalable Architecture

- Cloud-hosted infrastructure handles any studio size
- No software to install or maintain
- Automatic updates with zero downtime
- Containerized deployment with Docker support

---

## Subscription Tiers

### Basic Tier
- Full appointment scheduling
- Multi-location support
- Artist and customer management
- Comprehensive reporting
- Team collaboration features

### Plus Tier
*Everything in Basic, plus:*
- Automated appointment confirmation emails
- Configurable reminder notifications
- Calendar invite attachments
- Email bounce and unsubscribe tracking
- Priority support

---

## Technical Specifications

### Frontend
- **Framework**: React 18 with TypeScript
- **Routing**: React Router v6
- **State Management**: TanStack Query (React Query)
- **UI Components**: Radix UI primitives with custom styling
- **Styling**: Tailwind CSS with responsive design
- **Form Handling**: React Hook Form
- **Date Handling**: date-fns

### Backend
- **Database**: PostgreSQL via Supabase
- **Authentication**: Supabase Auth with email/password
- **API**: Supabase client with real-time subscriptions
- **Edge Functions**: Deno runtime for email processing
- **Email Service**: Mailjet integration

### Infrastructure
- **Hosting**: Docker-ready with Nginx reverse proxy
- **Security**: Row-level security policies
- **Monitoring**: Built-in error tracking and logging

---

## Support & Contact

For account activation, role changes, or technical support:

**Email**: ceteasystems@gmail.com

---

## License

InkFlow is proprietary software. All rights reserved.

---

*InkFlow — Where Creativity Meets Organization*
