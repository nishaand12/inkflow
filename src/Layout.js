import React, { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { normalizeUserRole } from "@/utils/roles";
import { base44 } from "@/api/base44Client";
import ArtistDialog from "@/components/artists/ArtistDialog";
import {
  Calendar,
  LayoutDashboard,
  MapPin,
  Clock,
  Settings,
  LogOut,
  CalendarCheck,
  UserPlus,
  Wrench,
  Palette,
  ClipboardList,
  BarChart3
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export default function Layout({ children, currentPageName = null }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [checkedAuth, setCheckedAuth] = useState(false);
  const [studioActive, setStudioActive] = useState(false);
  const [userArtist, setUserArtist] = useState(null);
  const [locations, setLocations] = useState([]);
  const [showArtistDialog, setShowArtistDialog] = useState(false);

  useEffect(() => {
    if (!checkedAuth) {
      loadUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkedAuth, location.pathname]);

  const loadUser = async () => {
    try {
      const currentUser = await base44.auth.me();
      
      // Onboarding check - if not onboarded, redirect to onboarding
      if (!currentUser.is_onboarded) {
        const path = window.location.pathname;
        if (!path.includes('OnboardingChoice')) {
          navigate(createPageUrl('OnboardingChoice'), { replace: true });
        }
        setUser(currentUser);
        setLoading(false);
        setCheckedAuth(true);
        return;
      }

      // Gatekeeper check - if studio is not active, redirect to pending validation
      if (currentUser.studio_id) {
        const studios = await base44.entities.Studio.filter({ id: currentUser.studio_id });
        if (studios.length > 0) {
          setStudioActive(studios[0].is_active);
          if (!studios[0].is_active) {
            const path = window.location.pathname;
            if (!path.includes('PendingValidation') && !path.includes('StudioSettings')) {
              navigate(createPageUrl('PendingValidation'), { replace: true });
              setUser(currentUser);
              setLoading(false);
              setCheckedAuth(true);
              return;
            }
          }
        }
      }
      
      setUser(currentUser);
      await loadArtistProfile(currentUser);
      setCheckedAuth(true);
    } catch (error) {
      console.error("Error loading user:", error);
      setCheckedAuth(true);
    } finally {
      setLoading(false);
    }
  };

  const loadArtistProfile = async (currentUser) => {
    if (!currentUser?.studio_id) return;
    try {
      const [artists, fetchedLocations] = await Promise.all([
        base44.entities.Artist.filter({ studio_id: currentUser.studio_id }),
        base44.entities.Location.filter({ studio_id: currentUser.studio_id })
      ]);
      const artist = artists.find(a => a.user_id === currentUser.id) || null;
      setUserArtist(artist);
      setLocations(fetchedLocations);
    } catch (error) {
      console.error("Error loading artist profile:", error);
    }
  };

  const handleLogout = () => {
    base44.auth.logout();
  };

  const getUserRole = () => {
    if (!user) return null;
    return normalizeUserRole(user.user_role || (user.role === 'admin' ? 'Admin' : 'Front_Desk'));
  };

  const getNavigationItems = () => {
    const userRole = getUserRole();
    
    const baseItems = [
      {
        title: "Dashboard",
        url: createPageUrl("Dashboard"),
        icon: LayoutDashboard,
        roles: ["Owner", "Admin", "Front_Desk", "Artist"]
      },
      {
        title: "Calendar",
        url: createPageUrl("Calendar"),
        icon: Calendar,
        roles: ["Owner", "Admin", "Front_Desk", "Artist"]
      },
      {
        title: "Appointments",
        url: createPageUrl("Appointments"),
        icon: CalendarCheck,
        roles: ["Owner", "Admin", "Front_Desk", "Artist"]
      }
    ];

    const managementItems = [
      {
        title: "Customers",
        url: createPageUrl("Customers"),
        icon: UserPlus,
        roles: ["Owner", "Admin", "Front_Desk"]
      },
      {
        title: "Artists",
        url: createPageUrl("Artists"),
        icon: Palette,
        roles: ["Owner", "Admin", "Front_Desk"]
      },
      {
        title: "Locations",
        url: createPageUrl("Locations"),
        icon: MapPin,
        roles: ["Owner", "Admin"]
      },
      {
        title: "Work Stations",
        url: createPageUrl("WorkStations"),
        icon: Wrench,
        roles: ["Owner", "Admin"]
      },
      {
        title: "Appointment Types",
        url: createPageUrl("AppointmentTypes"),
        icon: ClipboardList,
        roles: ["Owner", "Admin"]
      },
      {
        title: "Reports",
        url: createPageUrl("Reports"),
        icon: BarChart3,
        roles: ["Owner", "Admin"]
      },
      {
        title: "Studio Settings",
        url: createPageUrl("StudioSettings"),
        icon: Settings,
        roles: ["Owner", "Admin"]
      }
    ];

    const artistItems = [
      {
        title: "My Availability",
        url: createPageUrl("MyAvailability"),
        icon: Clock,
        roles: ["Artist", "Owner", "Admin"]
      }
    ];

    if (!user) return baseItems;

    let items = [...baseItems];
    
    items = [
      ...items,
      ...managementItems.filter(item => item.roles.includes(userRole)),
      ...artistItems.filter(item => item.roles.includes(userRole))
    ];

    return items;
  };

  const getRoleDisplay = () => {
    const userRole = getUserRole();
    const roleMap = {
      'Owner': 'Owner',
      'Admin': 'Administrator',
      'Front_Desk': 'Front Desk',
      'Artist': 'Artist'
    };
    return roleMap[userRole] || 'User';
  };

  const canOpenArtistProfile = () => {
    const userRole = getUserRole();
    return userRole === 'Artist' || userRole === 'Admin' || userRole === 'Owner';
  };

  const handleOpenArtistProfile = () => {
    if (!canOpenArtistProfile()) return;
    if (!userArtist) {
      window.alert("No artist profile found. Ask an owner/admin to create one.");
      return;
    }
    setShowArtistDialog(true);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  // Render pages without layout chrome during onboarding or pending validation
  const isOnboardingFlow = !user?.is_onboarded || 
    location.pathname.includes('OnboardingChoice') || 
    location.pathname.includes('PendingValidation') ||
    !studioActive;
  
  if (isOnboardingFlow) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100">
        {children}
      </div>
    );
  }

  return (
    <SidebarProvider>
      <style>{`
        :root {
          --primary: #6366F1;
          --primary-hover: #4F46E5;
          --secondary: #64748B;
          --background: #FAFAFA;
          --surface: #FFFFFF;
          --accent: #F59E0B;
          --text: #1E293B;
          --text-light: #64748B;
          --border: #E2E8F0;
        }
      `}</style>
      
      <div className="min-h-screen flex w-full bg-gray-50">
        <Sidebar className="border-r border-gray-200">
          <SidebarHeader className="border-b border-gray-200 p-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
                <Calendar className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="font-bold text-gray-900 text-lg">InkFlow</h2>
                <p className="text-xs text-gray-500">Studio Scheduling</p>
              </div>
            </div>
          </SidebarHeader>
          
          <SidebarContent className="p-3">
            <SidebarGroup>
              <SidebarGroupLabel className="text-xs font-semibold text-gray-500 uppercase tracking-wider px-3 py-2">
                Menu
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {getNavigationItems().map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton 
                        asChild 
                        className={`hover:bg-indigo-50 hover:text-indigo-700 transition-all duration-200 rounded-xl mb-1 ${
                          location.pathname === item.url ? 'bg-indigo-50 text-indigo-700 font-medium' : ''
                        }`}
                      >
                        <Link to={item.url} className="flex items-center gap-3 px-4 py-3">
                          <item.icon className="w-5 h-5" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-gray-200 p-4">
            {user && (
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handleOpenArtistProfile}
                  className={`flex items-center gap-3 px-2 text-left ${
                    canOpenArtistProfile() ? 'hover:bg-gray-100 rounded-lg py-2 transition' : ''
                  }`}
                >
                  <Avatar className="w-10 h-10 border-2 border-indigo-100">
                    <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white font-medium">
                      {user.full_name?.charAt(0) || user.email?.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate">{user.full_name || 'User'}</p>
                    <p className="text-xs text-gray-500 truncate">{getRoleDisplay()}</p>
                  </div>
                </button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-2 text-gray-600 hover:text-red-600 hover:border-red-200"
                  onClick={handleLogout}
                >
                  <LogOut className="w-4 h-4" />
                  Sign Out
                </Button>
              </div>
            )}
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 flex flex-col">
          <header className="bg-white border-b border-gray-200 px-6 py-4 lg:hidden">
            <div className="flex items-center gap-4">
              <SidebarTrigger className="hover:bg-gray-100 p-2 rounded-lg transition-colors duration-200" />
              <h1 className="text-xl font-bold text-gray-900">InkFlow</h1>
            </div>
          </header>

          <div className="flex-1 overflow-auto">
            {children}
          </div>
        </main>
      </div>
      {user && (
        <ArtistDialog
          open={showArtistDialog}
          onOpenChange={setShowArtistDialog}
          artist={userArtist}
          locations={locations}
        />
      )}
    </SidebarProvider>
  );
}