import { useEffect, useState, useMemo, useCallback } from "react";
import { DragDropContext, Droppable, Draggable, DropResult } from "@hello-pangea/dnd";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute, Link } from "wouter";
import { format, formatDistanceToNow } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Shield, Users, Mail, ArrowLeft, Plus, Trash2, Key, Pencil, Check, X, Copy, CheckCircle, Eye, EyeOff, Calendar, User as UserIcon, ChevronLeft, ChevronRight, Settings2, Layers, GripVertical, Archive, ArchiveRestore, BarChart2 } from "lucide-react";
import type { SafeUser, CrmModule, CrmModuleField, CrmModuleWithFields, CrmFieldType, crmFieldTypeValues } from "@shared/schema";

interface AdminUserDetails {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  profileImageUrl: string | null;
  role: string | null;
  lastGeneratedPassword: string | null;
  lastLoginAt: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export default function AdminPage() {
  const { toast } = useToast();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();
  const [isCreatePage] = useRoute("/admin/create");
  const [isUserDetailPage, userDetailParams] = useRoute("/admin/user/:id");

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      toast({
        title: "Session Expired",
        description: "Please sign in again.",
        variant: "destructive",
      });
      setLocation("/auth");
    }
  }, [isAuthenticated, authLoading, toast, setLocation]);

  useEffect(() => {
    if (!authLoading && user && user.role !== "admin") {
      toast({
        title: "Access Denied",
        description: "You don't have permission to access this page.",
        variant: "destructive",
      });
      setLocation("/");
    }
  }, [user, authLoading, toast, setLocation]);

  if (authLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!user || user.role !== "admin") {
    return null;
  }

  if (isCreatePage) {
    return <CreateUserPage />;
  }

  if (isUserDetailPage && userDetailParams?.id) {
    return <UserDetailPage userId={userDetailParams.id} />;
  }

  return <AdminMainPage />;
}

function AdminMainPage() {
  const [, setLocation] = useLocation();
  const [activeTab, setActiveTab] = useState("users");

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-admin-title">Administration</h1>
            <p className="text-sm text-muted-foreground">Manage users and system settings</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {activeTab === "users" && (
            <Button size="icon" onClick={() => setLocation("/admin/create")} data-testid="button-create-user">
              <Plus className="w-4 h-4" />
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setLocation("/admin/analytics")} data-testid="button-admin-analytics" className="gap-2">
            <BarChart2 className="w-4 h-4" />
            Analytics
          </Button>
          <Button size="icon" variant="outline" onClick={() => setLocation("/")} data-testid="button-back-admin">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="users" className="flex items-center gap-2" data-testid="tab-users">
            <Users className="w-4 h-4" />
            User Management
          </TabsTrigger>
          <TabsTrigger value="modules" className="flex items-center gap-2" data-testid="tab-modules">
            <Settings2 className="w-4 h-4" />
            Modules & Fields
          </TabsTrigger>
        </TabsList>
        <TabsContent value="users" className="mt-6">
          <UserManagementContent />
        </TabsContent>
        <TabsContent value="modules" className="mt-6">
          <ModulesFieldsContent />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function UserManagementContent() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ firstName: string; lastName: string; email: string; hoursPerDay: number }>({ firstName: "", lastName: "", email: "", hoursPerDay: 8 });
  const [copiedPassword, setCopiedPassword] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [showArchived, setShowArchived] = useState(false);
  const USERS_PER_PAGE = 10;

  const { data: users, isLoading: usersLoading } = useQuery<SafeUser[]>({
    queryKey: ["/api/admin/users"],
    enabled: !!user && user.role === "admin",
  });

  const archiveUserMutation = useMutation({
    mutationFn: async ({ userId, isArchived }: { userId: string; isArchived: boolean }) => {
      return await apiRequest("PATCH", `/api/admin/users/${userId}/archive`, { isArchived });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User updated" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update user", description: error.message, variant: "destructive" });
    },
  });

  const sortedUsers = useMemo(() => {
    if (!users) return [];
    const filtered = showArchived ? users : users.filter((u) => !u.isArchived);
    return [...filtered].sort((a, b) => {
      // Archived users last
      if (a.isArchived && !b.isArchived) return 1;
      if (!a.isArchived && b.isArchived) return -1;
      // Current logged-in admin first
      if (a.id === user?.id) return -1;
      if (b.id === user?.id) return 1;
      // Then other admins
      if (a.role === "admin" && b.role !== "admin") return -1;
      if (a.role !== "admin" && b.role === "admin") return 1;
      // Then alphabetically by name
      const nameA = `${a.firstName || ""} ${a.lastName || ""}`.toLowerCase();
      const nameB = `${b.firstName || ""} ${b.lastName || ""}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [users, user?.id, showArchived]);

  const totalPages = Math.ceil((sortedUsers?.length || 0) / USERS_PER_PAGE);
  const paginatedUsers = useMemo(() => {
    const startIndex = (currentPage - 1) * USERS_PER_PAGE;
    return sortedUsers.slice(startIndex, startIndex + USERS_PER_PAGE);
  }, [sortedUsers, currentPage]);

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return await apiRequest("PATCH", `/api/admin/users/${userId}/role`, { role });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User role updated successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update role",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ userId, data }: { userId: string; data: { firstName?: string; lastName?: string; email?: string; hoursPerDay?: number } }) => {
      return await apiRequest("PATCH", `/api/admin/users/${userId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setEditingUser(null);
      toast({ title: "User updated successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to update user",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("DELETE", `/api/admin/users/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "User deleted successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to delete user",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async (userId: string) => {
      return await apiRequest("POST", `/api/admin/users/${userId}/reset-password`);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      if (data.newPassword) {
        toast({ 
          title: "Password reset successfully",
          description: `New password: ${data.newPassword}${data.emailSent ? " (Email sent)" : " (Email failed to send)"}`
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: "Failed to reset password",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const startEditing = (u: SafeUser) => {
    setEditingUser(u.id);
    setEditForm({
      firstName: u.firstName || "",
      lastName: u.lastName || "",
      email: u.email,
      hoursPerDay: u.hoursPerDay || 8,
    });
  };

  const cancelEditing = () => {
    setEditingUser(null);
    setEditForm({ firstName: "", lastName: "", email: "", hoursPerDay: 8 });
  };

  const saveEditing = () => {
    if (editingUser) {
      updateUserMutation.mutate({ userId: editingUser, data: editForm });
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPassword(id);
    setTimeout(() => setCopiedPassword(null), 2000);
  };

  if (usersLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="w-5 h-5" />
              User Management
            </CardTitle>
            <CardDescription className="mt-1">
              View and manage all users. Create new users, update their info, or reset their passwords.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-muted-foreground"
            onClick={() => { setShowArchived((v) => !v); setCurrentPage(1); }}
            data-testid="button-toggle-archived"
          >
            {showArchived ? <ArchiveRestore className="w-4 h-4 mr-1.5" /> : <Archive className="w-4 h-4 mr-1.5" />}
            {showArchived ? "Hide archived" : "Show archived"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
          {!paginatedUsers || paginatedUsers.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No users found.</p>
          ) : (
            <div className="space-y-1.5">
              {paginatedUsers.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-col gap-3 p-3 border rounded-lg sm:flex-row sm:items-center sm:justify-between"
                  data-testid={`row-user-${u.id}`}
                >
                  {editingUser === u.id ? (
                    <div className="flex-1 grid grid-cols-1 gap-3 sm:grid-cols-4 sm:gap-4 sm:mr-4">
                      <Input
                        value={editForm.firstName}
                        onChange={(e) => setEditForm({ ...editForm, firstName: e.target.value })}
                        placeholder="First name"
                        data-testid={`input-firstname-${u.id}`}
                      />
                      <Input
                        value={editForm.lastName}
                        onChange={(e) => setEditForm({ ...editForm, lastName: e.target.value })}
                        placeholder="Last name"
                        data-testid={`input-lastname-${u.id}`}
                      />
                      <Input
                        value={editForm.email}
                        onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                        placeholder="Email"
                        type="email"
                        data-testid={`input-email-${u.id}`}
                      />
                      <Input
                        value={editForm.hoursPerDay}
                        onChange={(e) => setEditForm({ ...editForm, hoursPerDay: parseInt(e.target.value) || 8 })}
                        placeholder="Hours/day"
                        type="number"
                        min="1"
                        max="24"
                        data-testid={`input-hoursperday-${u.id}`}
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <Avatar className={`w-8 h-8 ${u.isArchived ? "opacity-40" : ""}`}>
                        <AvatarImage src={u.profileImageUrl || undefined} />
                        <AvatarFallback className="text-xs">
                          {u.firstName?.[0]}{u.lastName?.[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className={`font-medium text-sm flex items-center gap-2 ${u.isArchived ? "text-muted-foreground" : ""}`}>
                          {u.firstName} {u.lastName}
                          {u.isArchived && <Badge variant="secondary" className="text-[10px] py-0 px-1.5">Archived</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1">
                          <Mail className="w-3 h-3" />
                          {u.email}
                        </div>
                      </div>
                      <div className="hidden sm:block text-xs text-muted-foreground" title={u.lastLoginAt ? format(new Date(u.lastLoginAt), "PPpp") : "Never logged in"}>
                        <span className="text-muted-foreground/60">Last login:</span>{" "}
                        {u.lastLoginAt ? formatDistanceToNow(new Date(u.lastLoginAt), { addSuffix: true }) : "Never"}
                      </div>
                    </div>
                  )}
                  
                  <div className="flex items-center gap-2 flex-wrap">
                    {u.isMainAdmin === 1 ? (
                      <Badge variant="default">
                        SuperAdmin
                      </Badge>
                    ) : (
                      <Badge variant={u.role === "admin" ? "default" : "secondary"}>
                        {(u.role || "user").charAt(0).toUpperCase() + (u.role || "user").slice(1)}
                      </Badge>
                    )}

                    {editingUser === u.id ? (
                      <>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={saveEditing}
                          disabled={updateUserMutation.isPending}
                          data-testid={`button-save-${u.id}`}
                        >
                          <Check className="w-4 h-4 text-green-600" />
                        </Button>
                        <Button 
                          size="icon" 
                          variant="ghost" 
                          onClick={cancelEditing}
                          data-testid={`button-cancel-${u.id}`}
                        >
                          <X className="w-4 h-4 text-red-600" />
                        </Button>
                      </>
                    ) : (
                      <>
                        {u.id === user?.id || (u.isMainAdmin === 1 && user?.isMainAdmin !== 1) ? (
                          <Select value={u.role || "admin"} disabled>
                            <SelectTrigger className="w-24 opacity-60" data-testid={`select-role-${u.id}`}>
                              <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="admin">Admin</SelectItem>
                              <SelectItem value="user">User</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <Select
                            value={u.role || "user"}
                            onValueChange={(role) => updateRoleMutation.mutate({ userId: u.id, role })}
                            disabled={updateRoleMutation.isPending}
                          >
                            <SelectTrigger className="w-24" data-testid={`select-role-${u.id}`}>
                              <SelectValue placeholder="Role" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="user">User</SelectItem>
                              <SelectItem value="admin">Admin</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                        
                        {u.isMainAdmin === 1 && user?.isMainAdmin !== 1 ? (
                          <Button 
                            size="icon" 
                            variant="ghost"
                            disabled
                            className="opacity-40"
                            data-testid={`button-view-${u.id}`}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                        ) : (
                          <Link href={`/admin/user/${u.id}`}>
                            <Button 
                              size="icon" 
                              variant="ghost"
                              data-testid={`button-view-${u.id}`}
                            >
                              <Eye className="w-4 h-4" />
                            </Button>
                          </Link>
                        )}
                        
                        {u.isMainAdmin === 1 && user?.isMainAdmin !== 1 ? (
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            disabled
                            className="opacity-40"
                            data-testid={`button-edit-${u.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        ) : (
                          <Button 
                            size="icon" 
                            variant="ghost" 
                            onClick={() => startEditing(u)}
                            data-testid={`button-edit-${u.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        )}

                        {u.isMainAdmin === 1 && user?.isMainAdmin !== 1 ? (
                          <Button 
                            size="icon" 
                            variant="ghost"
                            disabled
                            className="opacity-40"
                            data-testid={`button-reset-password-${u.id}`}
                          >
                            <Key className="w-4 h-4" />
                          </Button>
                        ) : (
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button 
                              size="icon" 
                              variant="ghost"
                              disabled={resetPasswordMutation.isPending}
                              data-testid={`button-reset-password-${u.id}`}
                            >
                              <Key className="w-4 h-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Reset Password</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will generate a new random password for {u.firstName} {u.lastName} and send it to their email ({u.email}).
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => resetPasswordMutation.mutate(u.id)}>
                                Reset Password
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                        )}

                        {u.id !== user?.id && !(u.isMainAdmin === 1 && user?.isMainAdmin !== 1) ? (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              title={u.isArchived ? "Unarchive user" : "Archive user"}
                              disabled={archiveUserMutation.isPending}
                              onClick={() => archiveUserMutation.mutate({ userId: u.id, isArchived: !u.isArchived })}
                              data-testid={`button-archive-${u.id}`}
                            >
                              {u.isArchived
                                ? <ArchiveRestore className="w-4 h-4 text-muted-foreground" />
                                : <Archive className="w-4 h-4 text-muted-foreground" />}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  disabled={deleteUserMutation.isPending}
                                  data-testid={`button-delete-${u.id}`}
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete User</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete {u.firstName} {u.lastName}? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => deleteUserMutation.mutate(u.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </>
                        ) : (
                          <div className="w-9 h-9" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {totalPages > 1 && (
            <div className="flex flex-col gap-3 pt-4 border-t mt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground text-center sm:text-left">
                Showing {((currentPage - 1) * USERS_PER_PAGE) + 1} - {Math.min(currentPage * USERS_PER_PAGE, sortedUsers.length)} of {sortedUsers.length} users
              </p>
              <div className="flex items-center justify-center gap-2 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  data-testid="button-prev-page"
                >
                  <ChevronLeft className="w-4 h-4 mr-1" />
                  Previous
                </Button>
                <span className="text-sm px-2">
                  Page {currentPage} of {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  data-testid="button-next-page"
                >
                  Next
                  <ChevronRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
    </Card>
  );
}

function CreateUserPage() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [formData, setFormData] = useState({
    email: "",
    firstName: "",
    lastName: "",
    role: "user" as "user" | "admin",
  });
  const [createdUser, setCreatedUser] = useState<{ email: string; password: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const createUserMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      return await apiRequest("POST", "/api/admin/users", data);
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      setCreatedUser({
        email: formData.email,
        password: data.generatedPassword,
        emailSent: data.emailSent,
      });
      toast({ 
        title: "User created successfully",
        description: data.emailSent ? "Credentials sent via email" : "Email could not be sent - please share credentials manually"
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to create user",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createUserMutation.mutate(formData);
  };

  const copyCredentials = () => {
    if (createdUser) {
      navigator.clipboard.writeText(`Email: ${createdUser.email}\nPassword: ${createdUser.password}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Plus className="w-8 h-8 text-primary shrink-0" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-create-user-title">Create New User</h1>
            <p className="text-sm text-muted-foreground">Add a new user to the system</p>
          </div>
        </div>
        <Button variant="ghost" onClick={() => setLocation("/admin")} data-testid="button-back-to-admin">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Users
        </Button>
      </div>

      {createdUser ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <CheckCircle className="w-5 h-5" />
              User Created Successfully
            </CardTitle>
            <CardDescription>
              {createdUser.emailSent 
                ? "The user has been sent their credentials via email."
                : "Email could not be sent. Please share the credentials below manually."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-muted-foreground">Email</Label>
                  <p className="font-mono" data-testid="text-created-email">{createdUser.email}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-muted-foreground">Password</Label>
                  <p className="font-mono" data-testid="text-created-password">{createdUser.password}</p>
                </div>
              </div>
            </div>
            
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Button onClick={copyCredentials} variant="outline" data-testid="button-copy-credentials">
                {copied ? <Check className="w-4 h-4 mr-2" /> : <Copy className="w-4 h-4 mr-2" />}
                {copied ? "Copied!" : "Copy Credentials"}
              </Button>
              <Button onClick={() => {
                setCreatedUser(null);
                setFormData({ email: "", firstName: "", lastName: "", role: "user" });
              }} data-testid="button-create-another">
                Create Another User
              </Button>
              <Button variant="ghost" onClick={() => setLocation("/admin")} data-testid="button-done">
                Done
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>User Details</CardTitle>
            <CardDescription>
              Enter the user's information. A random password will be generated and sent to their email.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                    placeholder="John"
                    required
                    data-testid="input-create-firstname"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                    placeholder="Doe"
                    required
                    data-testid="input-create-lastname"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="john.doe@example.com"
                  required
                  data-testid="input-create-email"
                />
                <p className="text-sm text-muted-foreground">
                  The login credentials will be sent to this email address.
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value: "user" | "admin") => setFormData({ ...formData, role: value })}
                >
                  <SelectTrigger data-testid="select-create-role">
                    <SelectValue placeholder="Select role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="flex gap-2 pt-4">
                <Button type="submit" disabled={createUserMutation.isPending} data-testid="button-submit-create">
                  {createUserMutation.isPending ? "Creating..." : "Create User"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setLocation("/admin")}>
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function UserDetailPage({ userId }: { userId: string }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: userDetails, isLoading } = useQuery<AdminUserDetails>({
    queryKey: ["/api/admin/users", userId],
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/admin/users/${userId}/reset-password`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users", userId] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: "Password reset successfully" });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to reset password",
        description: error.message || "An error occurred",
        variant: "destructive",
      });
    },
  });

  const copyPassword = () => {
    if (userDetails?.lastGeneratedPassword) {
      navigator.clipboard.writeText(userDetails.lastGeneratedPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!userDetails) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">User Not Found</h1>
          <Button variant="ghost" onClick={() => setLocation("/admin")}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Users
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <UserIcon className="w-8 h-8 text-primary shrink-0" />
          <div>
            <h1 className="text-xl sm:text-2xl font-bold" data-testid="text-user-detail-title">User Details</h1>
            <p className="text-sm text-muted-foreground">View and manage user information</p>
          </div>
        </div>
        <Button variant="ghost" onClick={() => setLocation("/admin")} data-testid="button-back-to-users">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Users
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <Avatar className="w-16 h-16 shrink-0">
              <AvatarImage src={userDetails.profileImageUrl || undefined} />
              <AvatarFallback className="text-lg">
                {userDetails.firstName?.[0]}{userDetails.lastName?.[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-xl" data-testid="text-user-name">
                {userDetails.firstName} {userDetails.lastName}
              </CardTitle>
              <CardDescription className="flex items-center gap-1 break-all">
                <Mail className="w-4 h-4 shrink-0" />
                {userDetails.email}
              </CardDescription>
            </div>
            <Badge variant={userDetails.role === "admin" ? "default" : "secondary"} className="self-start sm:self-auto">
              {userDetails.role || "user"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-muted-foreground text-sm">First Name</Label>
              <p className="font-medium" data-testid="text-user-firstname">{userDetails.firstName || "-"}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-sm">Last Name</Label>
              <p className="font-medium" data-testid="text-user-lastname">{userDetails.lastName || "-"}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-sm">Email</Label>
              <p className="font-medium" data-testid="text-user-email">{userDetails.email}</p>
            </div>
            <div className="space-y-1">
              <Label className="text-muted-foreground text-sm">Role</Label>
              <p className="font-medium" data-testid="text-user-role">{userDetails.role || "user"}</p>
            </div>
            {userDetails.createdAt && (
              <div className="space-y-1">
                <Label className="text-muted-foreground text-sm">Created</Label>
                <p className="font-medium flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {new Date(userDetails.createdAt).toLocaleDateString()}
                </p>
              </div>
            )}
            {userDetails.updatedAt && (
              <div className="space-y-1">
                <Label className="text-muted-foreground text-sm">Last Updated</Label>
                <p className="font-medium flex items-center gap-1">
                  <Calendar className="w-4 h-4" />
                  {new Date(userDetails.updatedAt).toLocaleDateString()}
                </p>
              </div>
            )}
          </div>

          <div className="border-t pt-4">
            <Label className="text-muted-foreground text-sm">Last Generated Password</Label>
            {userDetails.lastGeneratedPassword ? (
              <div className="flex items-center gap-2 mt-2">
                <div className="bg-muted px-3 py-2 rounded-md font-mono flex-1" data-testid="text-generated-password">
                  {showPassword ? userDetails.lastGeneratedPassword : "••••••••••••••••"}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={copyPassword}
                  data-testid="button-copy-password"
                >
                  {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
            ) : (
              <p className="text-muted-foreground mt-2" data-testid="text-no-password">
                No generated password available. The user may have set their own password.
              </p>
            )}
          </div>

          <div className="border-t pt-4 flex gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="outline" disabled={resetPasswordMutation.isPending} data-testid="button-reset-user-password">
                  <Key className="w-4 h-4 mr-2" />
                  Reset Password
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset Password</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will generate a new random password for {userDetails.firstName} {userDetails.lastName} and send it to their email ({userDetails.email}).
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => resetPasswordMutation.mutate()}>
                    Reset Password
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const FIELD_TYPES: { value: string; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date & Time" },
  { value: "select", label: "Dropdown" },
  { value: "multiselect", label: "Multi-Select" },
  { value: "checkbox", label: "Checkbox" },
  { value: "textarea", label: "Text Area" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "url", label: "URL" },
  { value: "currency", label: "Currency" },
];

function ModulesFieldsContent() {
  const { toast } = useToast();
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [showCreateModule, setShowCreateModule] = useState(false);
  
  const [moduleForm, setModuleForm] = useState({
    name: "",
    slug: "",
    description: "",
    icon: "",
    isEnabled: 1,
  });

  const { data: modules, isLoading } = useQuery<CrmModuleWithFields[]>({
    queryKey: ["/api/admin/modules"],
  });

  const createModuleMutation = useMutation({
    mutationFn: async (data: typeof moduleForm) => {
      return await apiRequest("POST", "/api/admin/modules", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] });
      setShowCreateModule(false);
      resetModuleForm();
      toast({ title: "Module created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create module", description: error.message, variant: "destructive" });
    },
  });

  const resetModuleForm = () => {
    setModuleForm({ name: "", slug: "", description: "", icon: "", isEnabled: 1 });
  };

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  };

  const handleModuleNameChange = (name: string) => {
    setModuleForm(f => ({ ...f, name, slug: generateSlug(name) }));
  };

  const selectedModule = modules?.find(m => m.id === selectedModuleId);

  // If a module is selected, show the detail view
  if (selectedModuleId && selectedModule) {
    return (
      <ModuleDetailView
        module={selectedModule}
        onBack={() => setSelectedModuleId(null)}
      />
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Layers className="w-5 h-5" />
                Modules
              </CardTitle>
              <CardDescription>
                Click on a module to view and configure its fields
              </CardDescription>
            </div>
            <Dialog open={showCreateModule} onOpenChange={setShowCreateModule}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-create-module">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Module
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Module</DialogTitle>
                  <DialogDescription>Add a new customizable module</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <Label>Name</Label>
                    <Input
                      value={moduleForm.name}
                      onChange={(e) => handleModuleNameChange(e.target.value)}
                      placeholder="e.g., Products"
                      data-testid="input-module-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug</Label>
                    <Input
                      value={moduleForm.slug}
                      onChange={(e) => setModuleForm(f => ({ ...f, slug: e.target.value }))}
                      placeholder="products"
                      data-testid="input-module-slug"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={moduleForm.description}
                      onChange={(e) => setModuleForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="Optional description..."
                      data-testid="input-module-description"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={moduleForm.isEnabled === 1}
                      onCheckedChange={(checked) => setModuleForm(f => ({ ...f, isEnabled: checked ? 1 : 0 }))}
                      data-testid="switch-module-enabled"
                    />
                    <Label>Enabled</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setShowCreateModule(false); resetModuleForm(); }}>Cancel</Button>
                  <Button
                    onClick={() => createModuleMutation.mutate(moduleForm)}
                    disabled={!moduleForm.name || !moduleForm.slug || createModuleMutation.isPending}
                    data-testid="button-save-module"
                  >
                    Create Module
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!modules || modules.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No modules configured. Create your first module to get started.</p>
          ) : (
            <div className="space-y-3">
              {modules.map((mod) => (
                <div
                  key={mod.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover-elevate cursor-pointer"
                  onClick={() => setSelectedModuleId(mod.id)}
                  data-testid={`module-${mod.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      {mod.slug === "projects" ? (
                        <Layers className="w-5 h-5 text-primary" />
                      ) : mod.slug === "contacts" ? (
                        <Users className="w-5 h-5 text-primary" />
                      ) : (
                        <Layers className="w-5 h-5 text-primary" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{mod.name}</span>
                        {mod.isSystem === 1 && (
                          <Badge variant="outline" className="text-xs">System</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {mod.fields?.length || 0} fields configured
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={mod.isEnabled ? "default" : "secondary"}>
                      {mod.isEnabled ? "Active" : "Inactive"}
                    </Badge>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ModuleDetailView({ module, onBack }: { module: CrmModuleWithFields; onBack: () => void }) {
  const { toast } = useToast();
  const [showCreateField, setShowCreateField] = useState(false);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [fieldForm, setFieldForm] = useState({
    name: "",
    slug: "",
    fieldType: "text",
    description: "",
    placeholder: "",
    defaultValue: "",
    options: [] as string[],
    isRequired: 0,
    isEnabled: 1,
  });
  const [optionsText, setOptionsText] = useState("");

  const createFieldMutation = useMutation({
    mutationFn: async (data: typeof fieldForm) => {
      return await apiRequest("POST", `/api/admin/modules/${module.id}/fields`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/modules/projects/fields"] });
      queryClient.invalidateQueries({ queryKey: ["/api/modules/contacts/fields"] });
      setShowCreateField(false);
      resetFieldForm();
      toast({ title: "Field created successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to create field", description: error.message, variant: "destructive" });
    },
  });

  const deleteFieldMutation = useMutation({
    mutationFn: async (id: string) => {
      return await apiRequest("DELETE", `/api/admin/fields/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/modules/projects/fields"] });
      queryClient.invalidateQueries({ queryKey: ["/api/modules/contacts/fields"] });
      toast({ title: "Field deleted successfully" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete field", description: error.message, variant: "destructive" });
    },
  });

  const toggleModuleMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      return await apiRequest("PATCH", `/api/admin/modules/${module.id}`, { isEnabled: enabled ? 1 : 0 });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] });
      toast({ title: module.isEnabled ? "Module disabled" : "Module enabled" });
    },
    onError: (error: any) => {
      toast({ title: "Failed to update module", description: error.message, variant: "destructive" });
    },
  });

  const deleteModuleMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/admin/modules/${module.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] });
      toast({ title: "Module deleted successfully" });
      onBack();
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete module", description: error.message, variant: "destructive" });
    },
  });

  const resetFieldForm = () => {
    setFieldForm({ name: "", slug: "", fieldType: "text", description: "", placeholder: "", defaultValue: "", options: [], isRequired: 0, isEnabled: 1 });
    setOptionsText("");
  };

  const generateSlug = (name: string) => {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  };

  const handleFieldNameChange = (name: string) => {
    setFieldForm(f => ({ ...f, name, slug: generateSlug(name) }));
  };

  const handleOptionsChange = (text: string) => {
    setOptionsText(text);
    const opts = text.split("\n").map(o => o.trim()).filter(o => o.length > 0);
    setFieldForm(f => ({ ...f, options: opts }));
  };

  const selectedField = module.fields?.find(f => f.id === selectedFieldId);

  // If a field is selected, show the field detail view
  if (selectedFieldId && selectedField) {
    return (
      <FieldDetailView
        field={selectedField}
        module={module}
        onBack={() => setSelectedFieldId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-module">
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              {module.slug === "projects" ? (
                <Layers className="w-5 h-5 text-primary" />
              ) : module.slug === "contacts" ? (
                <Users className="w-5 h-5 text-primary" />
              ) : (
                <Layers className="w-5 h-5 text-primary" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">{module.name}</h2>
                {module.isSystem === 1 && (
                  <Badge variant="outline" className="text-xs">System</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{module.description || "Configure fields for this module"}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Label htmlFor="module-enabled" className="text-sm">Enabled</Label>
            <Switch
              id="module-enabled"
              checked={module.isEnabled === 1}
              onCheckedChange={(checked) => toggleModuleMutation.mutate(checked)}
              disabled={toggleModuleMutation.isPending}
              data-testid="switch-module-enabled"
            />
          </div>
          {module.isSystem !== 1 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" data-testid="button-delete-module">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Module
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Module</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete the "{module.name}" module? This will also delete all its fields and cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleteModuleMutation.mutate()}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Fields</CardTitle>
              <CardDescription>Manage the fields for {module.name}</CardDescription>
            </div>
            <Dialog open={showCreateField} onOpenChange={setShowCreateField}>
              <DialogTrigger asChild>
                <Button size="sm" data-testid="button-add-field">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Field
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add Field to {module.name}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4 max-h-[60vh] overflow-y-auto">
                  <div className="space-y-2">
                    <Label>Field Name</Label>
                    <Input
                      value={fieldForm.name}
                      onChange={(e) => handleFieldNameChange(e.target.value)}
                      placeholder="e.g., Budget Amount"
                      data-testid="input-field-name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Slug</Label>
                    <Input
                      value={fieldForm.slug}
                      onChange={(e) => setFieldForm(f => ({ ...f, slug: e.target.value }))}
                      placeholder="budget_amount"
                      data-testid="input-field-slug"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Field Type</Label>
                    <Select value={fieldForm.fieldType} onValueChange={(v) => setFieldForm(f => ({ ...f, fieldType: v }))}>
                      <SelectTrigger data-testid="select-field-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {FIELD_TYPES.map(ft => (
                          <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {(fieldForm.fieldType === "select" || fieldForm.fieldType === "multiselect") && (
                    <div className="space-y-2">
                      <Label>Options (one per line)</Label>
                      <Textarea
                        value={optionsText}
                        onChange={(e) => handleOptionsChange(e.target.value)}
                        placeholder="Option 1&#10;Option 2&#10;Option 3"
                        rows={4}
                        data-testid="input-field-options"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Placeholder</Label>
                    <Input
                      value={fieldForm.placeholder}
                      onChange={(e) => setFieldForm(f => ({ ...f, placeholder: e.target.value }))}
                      placeholder="Enter value..."
                      data-testid="input-field-placeholder"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Default Value</Label>
                    <Input
                      value={fieldForm.defaultValue}
                      onChange={(e) => setFieldForm(f => ({ ...f, defaultValue: e.target.value }))}
                      data-testid="input-field-default"
                    />
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={fieldForm.isRequired === 1}
                        onCheckedChange={(checked) => setFieldForm(f => ({ ...f, isRequired: checked ? 1 : 0 }))}
                        data-testid="switch-field-required"
                      />
                      <Label>Required</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={fieldForm.isEnabled === 1}
                        onCheckedChange={(checked) => setFieldForm(f => ({ ...f, isEnabled: checked ? 1 : 0 }))}
                        data-testid="switch-field-enabled"
                      />
                      <Label>Enabled</Label>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => { setShowCreateField(false); resetFieldForm(); }}>Cancel</Button>
                  <Button
                    onClick={() => createFieldMutation.mutate(fieldForm)}
                    disabled={!fieldForm.name || !fieldForm.slug || createFieldMutation.isPending}
                    data-testid="button-save-field"
                  >
                    Create Field
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {!module.fields || module.fields.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No fields configured. Add your first field to get started.</p>
          ) : (
            <div className="space-y-2">
              {module.fields.map((field) => (
                <div
                  key={field.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover-elevate cursor-pointer"
                  onClick={() => setSelectedFieldId(field.id)}
                  data-testid={`field-${field.id}`}
                >
                  <div className="flex items-center gap-3">
                    <GripVertical className="w-4 h-4 text-muted-foreground/50" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{field.name}</span>
                        {field.isRequired === 1 && (
                          <span className="text-destructive text-xs">*</span>
                        )}
                        {field.isSystem === 1 && (
                          <Badge variant="outline" className="text-xs">System</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span>{FIELD_TYPES.find(ft => ft.value === field.fieldType)?.label || field.fieldType}</span>
                        <span className="text-muted-foreground/50">|</span>
                        <code className="bg-muted px-1.5 py-0.5 rounded text-xs">{field.slug}</code>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={field.isEnabled ? "default" : "secondary"}>
                      {field.isEnabled ? "Active" : "Inactive"}
                    </Badge>
                    <ChevronRight className="w-5 h-5 text-muted-foreground" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const OPTION_COLORS = [
  { value: "#6366f1", label: "Indigo" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#a855f7", label: "Purple" },
  { value: "#d946ef", label: "Fuchsia" },
  { value: "#ec4899", label: "Pink" },
  { value: "#f43f5e", label: "Rose" },
  { value: "#ef4444", label: "Red" },
  { value: "#f97316", label: "Orange" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#eab308", label: "Yellow" },
  { value: "#84cc16", label: "Lime" },
  { value: "#22c55e", label: "Green" },
  { value: "#10b981", label: "Emerald" },
  { value: "#14b8a6", label: "Teal" },
  { value: "#06b6d4", label: "Cyan" },
  { value: "#0ea5e9", label: "Sky" },
  { value: "#3b82f6", label: "Blue" },
  { value: "#64748b", label: "Slate" },
  { value: "#71717a", label: "Zinc" },
  { value: "#737373", label: "Neutral" },
];

interface OptionWithColor {
  label: string;
  color: string;
}

function parseOptions(options: string[] | null): OptionWithColor[] {
  if (!options || options.length === 0) return [];
  return options.map(opt => {
    try {
      const parsed = JSON.parse(opt);
      if (parsed && typeof parsed === 'object' && parsed.label) {
        return { label: parsed.label, color: parsed.color || "#64748b" };
      }
    } catch {
      // Legacy format: just a string
    }
    return { label: opt, color: "#64748b" };
  });
}

function serializeOptions(options: OptionWithColor[]): string[] {
  return options.map(opt => JSON.stringify({ label: opt.label, color: opt.color }));
}

function FieldDetailView({ field, module, onBack }: { field: CrmModuleField; module: CrmModuleWithFields; onBack: () => void }) {
  const { toast } = useToast();
  const [fieldForm, setFieldForm] = useState({
    name: field.name,
    slug: field.slug,
    fieldType: field.fieldType,
    description: field.description || "",
    placeholder: field.placeholder || "",
    defaultValue: field.defaultValue || "",
    options: field.options || [],
    isRequired: field.isRequired,
    isEnabled: field.isEnabled,
  });
  
  const [optionItems, setOptionItems] = useState<OptionWithColor[]>(parseOptions(field.options));
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const [newOptionColor, setNewOptionColor] = useState("#64748b");

  const updateFieldMutation = useMutation({
    mutationFn: async (data: Partial<typeof fieldForm>) => {
      return await apiRequest("PATCH", `/api/admin/fields/${field.id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/modules/projects/fields"] });
      queryClient.invalidateQueries({ queryKey: ["/api/modules/contacts/fields"] });
      toast({ title: "Field updated successfully" });
      onBack();
    },
    onError: (error: any) => {
      toast({ title: "Failed to update field", description: error.message, variant: "destructive" });
    },
  });

  const deleteFieldMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("DELETE", `/api/admin/fields/${field.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/modules"] });
      queryClient.invalidateQueries({ queryKey: ["/api/modules/projects/fields"] });
      queryClient.invalidateQueries({ queryKey: ["/api/modules/contacts/fields"] });
      toast({ title: "Field deleted successfully" });
      onBack();
    },
    onError: (error: any) => {
      toast({ title: "Failed to delete field", description: error.message, variant: "destructive" });
    },
  });

  const addOption = () => {
    if (!newOptionLabel.trim()) return;
    const newOptions = [...optionItems, { label: newOptionLabel.trim(), color: newOptionColor }];
    setOptionItems(newOptions);
    setFieldForm(f => ({ ...f, options: serializeOptions(newOptions) }));
    setNewOptionLabel("");
    setNewOptionColor("#64748b");
  };

  const removeOption = (index: number) => {
    const newOptions = optionItems.filter((_, i) => i !== index);
    setOptionItems(newOptions);
    setFieldForm(f => ({ ...f, options: serializeOptions(newOptions) }));
  };

  const updateOptionColor = (index: number, color: string) => {
    const newOptions = optionItems.map((opt, i) => i === index ? { ...opt, color } : opt);
    setOptionItems(newOptions);
    setFieldForm(f => ({ ...f, options: serializeOptions(newOptions) }));
  };

  const updateOptionLabel = (index: number, label: string) => {
    const newOptions = optionItems.map((opt, i) => i === index ? { ...opt, label } : opt);
    setOptionItems(newOptions);
    setFieldForm(f => ({ ...f, options: serializeOptions(newOptions) }));
  };

  const handleOptionsDragEnd = useCallback((result: DropResult) => {
    if (!result.destination) return;
    if (result.destination.index === result.source.index) return;
    
    const reordered = Array.from(optionItems);
    const [removed] = reordered.splice(result.source.index, 1);
    reordered.splice(result.destination.index, 0, removed);
    
    setOptionItems(reordered);
    setFieldForm(f => ({ ...f, options: serializeOptions(reordered) }));
  }, [optionItems]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={onBack} data-testid="button-back-field">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">{field.name}</h2>
            {field.isSystem === 1 && (
              <Badge variant="outline">System Field</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {module.name} / {FIELD_TYPES.find(ft => ft.value === field.fieldType)?.label || field.fieldType}
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Field Settings</CardTitle>
          <CardDescription>Configure the properties of this field</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Field Name</Label>
              <Input
                value={fieldForm.name}
                onChange={(e) => setFieldForm(f => ({ ...f, name: e.target.value }))}
                data-testid="input-field-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Slug</Label>
              <Input
                value={fieldForm.slug}
                onChange={(e) => setFieldForm(f => ({ ...f, slug: e.target.value }))}
                disabled={field.isSystem === 1}
                data-testid="input-field-slug"
              />
              <p className="text-xs text-muted-foreground">Used as the internal identifier</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Field Type</Label>
            <Select 
              value={fieldForm.fieldType} 
              onValueChange={(v) => setFieldForm(f => ({ ...f, fieldType: v }))}
              disabled={field.isSystem === 1}
            >
              <SelectTrigger data-testid="select-field-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FIELD_TYPES.map(ft => (
                  <SelectItem key={ft.value} value={ft.value}>{ft.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(fieldForm.fieldType === "select" || fieldForm.fieldType === "multiselect") && (
            <div className="space-y-4">
              <Label>Options (drag to reorder)</Label>
              
              {optionItems.length > 0 && (
                <DragDropContext onDragEnd={handleOptionsDragEnd}>
                  <Droppable droppableId="options">
                    {(provided) => (
                      <div 
                        {...provided.droppableProps} 
                        ref={provided.innerRef}
                        className="space-y-2"
                      >
                        {optionItems.map((opt, index) => (
                          <Draggable key={`option-${index}`} draggableId={`option-${index}`} index={index}>
                            {(provided, snapshot) => (
                              <div 
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                className={`flex items-center gap-2 p-2 border rounded-lg ${snapshot.isDragging ? 'shadow-lg bg-background' : ''}`} 
                                data-testid={`option-${index}`}
                              >
                                <div
                                  {...provided.dragHandleProps}
                                  className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
                                >
                                  <GripVertical className="w-4 h-4 text-muted-foreground" />
                                </div>
                                <Popover>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      className="w-8 h-8 rounded-md border shrink-0"
                                      style={{ backgroundColor: opt.color }}
                                      data-testid={`option-color-trigger-${index}`}
                                    />
                                  </PopoverTrigger>
                                  <PopoverContent className="w-auto p-3" align="start">
                                    <div className="grid grid-cols-5 gap-2">
                                      {OPTION_COLORS.map((c) => (
                                        <button
                                          key={c.value}
                                          type="button"
                                          className={`w-8 h-8 rounded-md border-2 ${opt.color === c.value ? 'border-foreground' : 'border-transparent'}`}
                                          style={{ backgroundColor: c.value }}
                                          onClick={() => updateOptionColor(index, c.value)}
                                          title={c.label}
                                          data-testid={`color-${c.value}`}
                                        />
                                      ))}
                                    </div>
                                  </PopoverContent>
                                </Popover>
                                <Input
                                  value={opt.label}
                                  onChange={(e) => updateOptionLabel(index, e.target.value)}
                                  className="flex-1"
                                  data-testid={`option-label-${index}`}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeOption(index)}
                                  data-testid={`option-remove-${index}`}
                                >
                                  <X className="w-4 h-4" />
                                </Button>
                              </div>
                            )}
                          </Draggable>
                        ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </DragDropContext>
              )}

              <div className="flex items-center gap-2 p-2 border rounded-lg border-dashed">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="w-8 h-8 rounded-md border shrink-0"
                      style={{ backgroundColor: newOptionColor }}
                      data-testid="new-option-color-trigger"
                    />
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-3" align="start">
                    <div className="grid grid-cols-5 gap-2">
                      {OPTION_COLORS.map((c) => (
                        <button
                          key={c.value}
                          type="button"
                          className={`w-8 h-8 rounded-md border-2 ${newOptionColor === c.value ? 'border-foreground' : 'border-transparent'}`}
                          style={{ backgroundColor: c.value }}
                          onClick={() => setNewOptionColor(c.value)}
                          title={c.label}
                        />
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <Input
                  value={newOptionLabel}
                  onChange={(e) => setNewOptionLabel(e.target.value)}
                  placeholder="Add new option..."
                  className="flex-1"
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addOption())}
                  data-testid="new-option-input"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                  disabled={!newOptionLabel.trim()}
                  data-testid="button-add-option"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Click the color swatch to change the background color of each option</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Placeholder</Label>
              <Input
                value={fieldForm.placeholder}
                onChange={(e) => setFieldForm(f => ({ ...f, placeholder: e.target.value }))}
                placeholder="Enter placeholder text..."
                data-testid="input-field-placeholder"
              />
            </div>
            <div className="space-y-2">
              <Label>Default Value</Label>
              <Input
                value={fieldForm.defaultValue}
                onChange={(e) => setFieldForm(f => ({ ...f, defaultValue: e.target.value }))}
                data-testid="input-field-default"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={fieldForm.description}
              onChange={(e) => setFieldForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Describe this field..."
              rows={2}
              data-testid="input-field-description"
            />
          </div>

          <div className="flex items-center gap-6 pt-4 border-t">
            <div className="flex items-center gap-2">
              <Switch
                checked={fieldForm.isRequired === 1}
                onCheckedChange={(checked) => setFieldForm(f => ({ ...f, isRequired: checked ? 1 : 0 }))}
                data-testid="switch-field-required"
              />
              <Label>Required Field</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={fieldForm.isEnabled === 1}
                onCheckedChange={(checked) => setFieldForm(f => ({ ...f, isEnabled: checked ? 1 : 0 }))}
                data-testid="switch-field-enabled"
              />
              <Label>Enabled</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <div>
          {field.isSystem !== 1 && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" data-testid="button-delete-field">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete Field
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Field</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete "{field.name}"? This will remove all data stored in this field. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => deleteFieldMutation.mutate()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onBack}>Cancel</Button>
          <Button
            onClick={() => updateFieldMutation.mutate(fieldForm)}
            disabled={!fieldForm.name || !fieldForm.slug || updateFieldMutation.isPending}
            data-testid="button-save-field"
          >
            {updateFieldMutation.isPending ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </div>
    </div>
  );
}
