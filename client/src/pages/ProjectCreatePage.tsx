import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { format, addDays } from "date-fns";
import { 
  ArrowLeft,
  FolderKanban,
  Save,
  CalendarDays,
  Clock,
  Check,
  ChevronsUpDown,
  X,
  Users
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { CrmClient, CrmProjectStatus, CrmProjectType, CrmModuleField, SafeUser } from "@shared/schema";

// Helper to parse field options from database format
interface ParsedOption {
  value: string;
  label: string;
  color: string;
}

function parseFieldOptions(options: string[] | null): ParsedOption[] {
  if (!options || options.length === 0) return [];
  return options.map(opt => {
    try {
      const parsed = JSON.parse(opt);
      if (parsed && typeof parsed === 'object' && parsed.label) {
        const value = parsed.label.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
        return { value, label: parsed.label, color: parsed.color || "#64748b" };
      }
    } catch {
      // Legacy format: just a string
    }
    const value = opt.toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
    return { value, label: opt, color: "#64748b" };
  });
}

// Fallback static config (used if API hasn't loaded yet)
const fallbackStatusConfig: Record<string, { label: string; color: string }> = {
  lead: { label: "Lead", color: "#64748b" },
  discovering_call_completed: { label: "Discovery Call Completed", color: "#8b5cf6" },
  proposal_sent: { label: "Proposal Sent", color: "#f59e0b" },
  follow_up: { label: "Follow Up", color: "#06b6d4" },
  in_negotiation: { label: "In Negotiation", color: "#3b82f6" },
  won: { label: "Won", color: "#22c55e" },
  won_not_started: { label: "Won - Not Started", color: "#10b981" },
  won_in_progress: { label: "Won - In Progress", color: "#14b8a6" },
  won_in_review: { label: "Won - In Review", color: "#0ea5e9" },
  won_completed: { label: "Won - Completed", color: "#84cc16" },
  lost: { label: "Lost", color: "#ef4444" },
  won_cancelled: { label: "Won-Cancelled", color: "#f43f5e" },
};

// Fallback project type config
const fallbackProjectTypeConfig: Record<string, { label: string; color: string; description: string }> = {
  one_time: { label: "One-Time Project", color: "#3b82f6", description: "1 week duration" },
  monthly: { label: "Monthly Project", color: "#8b5cf6", description: "1 month duration" },
  hourly_budget: { label: "Hourly Budget", color: "#f59e0b", description: "Based on budgeted hours" },
  internal: { label: "Internal", color: "#64748b", description: "Internal project" },
};

export default function ProjectCreatePage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  // Read clientId from URL query params
  const urlParams = new URLSearchParams(window.location.search);
  const preselectedClientId = urlParams.get("clientId") || "";

  const [formData, setFormData] = useState({
    name: "",
    description: "",
    clientId: preselectedClientId,
    status: "lead" as CrmProjectStatus,
    projectType: "one_time" as CrmProjectType,
    startDate: null as Date | null,
    budgetedHours: "",
    budgetedMinutes: "",
    actualHours: "",
    actualMinutes: "",
  });
  const [contactOpen, setContactOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);

  // Pre-select the current user once loaded
  useEffect(() => {
    if (user?.id && !selectedMemberIds.includes(user.id)) {
      setSelectedMemberIds([user.id]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const { data: clients = [] } = useQuery<CrmClient[]>({
    queryKey: ["/api/crm/clients"],
  });

  const { data: allUsers = [] } = useQuery<SafeUser[]>({
    queryKey: ["/api/users"],
    queryFn: async () => {
      const res = await fetch("/api/users", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });

  // Fetch project module fields for dynamic status options
  const { data: projectFields = [] } = useQuery<CrmModuleField[]>({
    queryKey: ["/api/modules/projects/fields"],
  });

  // Parse status options from database
  const { statusOptions, statusConfig } = useMemo(() => {
    const statusField = projectFields.find(f => f.slug === "status");
    if (statusField && statusField.options && statusField.options.length > 0) {
      const parsed = parseFieldOptions(statusField.options);
      const config: Record<string, { label: string; color: string }> = {};
      const options: string[] = [];
      parsed.forEach(opt => {
        config[opt.value] = { label: opt.label, color: opt.color };
        options.push(opt.value);
      });
      return { statusOptions: options, statusConfig: config };
    }
    // Fallback to static config
    return { 
      statusOptions: Object.keys(fallbackStatusConfig), 
      statusConfig: fallbackStatusConfig 
    };
  }, [projectFields]);

  // Parse project type options from database
  const { projectTypeOptions, projectTypeConfig } = useMemo(() => {
    const typeField = projectFields.find(f => f.slug === "project_type");
    if (typeField && typeField.options && typeField.options.length > 0) {
      const parsed = parseFieldOptions(typeField.options);
      const config: Record<string, { label: string; color: string; description: string }> = {};
      const options: string[] = [];
      parsed.forEach(opt => {
        config[opt.value] = { label: opt.label, color: opt.color, description: "" };
        options.push(opt.value);
      });
      return { projectTypeOptions: options, projectTypeConfig: config };
    }
    // Fallback to static config
    return { 
      projectTypeOptions: Object.keys(fallbackProjectTypeConfig), 
      projectTypeConfig: fallbackProjectTypeConfig 
    };
  }, [projectFields]);

  // Update formData.clientId when URL param is present and clients are loaded
  useEffect(() => {
    if (preselectedClientId && clients.length > 0 && !formData.clientId) {
      const clientExists = clients.find(c => c.id === preselectedClientId);
      if (clientExists) {
        setFormData(prev => ({ ...prev, clientId: preselectedClientId }));
      }
    }
  }, [preselectedClientId, clients, formData.clientId]);

  const selectedClient = useMemo(() => 
    clients.find(c => c.id === formData.clientId),
    [clients, formData.clientId]
  );

  // Calculate due date based on project type and start date
  const hoursPerDay = user?.hoursPerDay || 8;
  const calculateDueDate = useMemo(() => {
    if (!formData.startDate) return null;
    
    switch (formData.projectType) {
      case "one_time":
        // 1 week duration
        return addDays(formData.startDate, 7);
      case "monthly":
        // 1 month duration (30 days)
        return addDays(formData.startDate, 30);
      case "hourly_budget":
        // Based on budgeted hours
        if (formData.budgetedHours) {
          return addDays(formData.startDate, Math.ceil(parseInt(formData.budgetedHours) / hoursPerDay));
        }
        return null;
      case "internal":
        // Internal projects have no fixed duration
        return null;
      default:
        return null;
    }
  }, [formData.startDate, formData.projectType, formData.budgetedHours, hoursPerDay]);

  const createProjectMutation = useMutation({
    mutationFn: async (data: { name: string; description?: string | null; clientId?: string | null; status?: string | null; projectType?: string | null; startDate?: string | null; dueDate?: string | null; budgetedHours?: number | null; budgetedMinutes?: number | null; actualHours?: number | null; actualMinutes?: number | null; memberIds?: string[] }) => {
      return apiRequest("POST", "/api/crm/projects", data);
    },
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects"], exact: false });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all-kanban"] });
      queryClient.invalidateQueries({ queryKey: ["/api/crm/projects/all"] });
      toast({
        title: "Project Created",
        description: "The project has been created successfully.",
      });
      navigate(`/crm/project/${response.crmProject.id}`);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message || "Failed to create project",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast({
        title: "Validation Error",
        description: "Project name is required",
        variant: "destructive",
      });
      return;
    }
    if (!formData.description.trim()) {
      toast({
        title: "Validation Error",
        description: "Project description is required",
        variant: "destructive",
      });
      return;
    }
    if (!formData.startDate) {
      toast({
        title: "Validation Error",
        description: "Start date is required",
        variant: "destructive",
      });
      return;
    }
    createProjectMutation.mutate({
      name: formData.name,
      description: formData.description || null,
      clientId: formData.clientId || null,
      status: formData.status || "lead",
      projectType: formData.projectType || "one_time",
      startDate: formData.startDate?.toISOString() || null,
      dueDate: calculateDueDate?.toISOString() || null,
      budgetedHours: formData.budgetedHours ? parseInt(formData.budgetedHours) : null,
      budgetedMinutes: formData.budgetedMinutes ? parseInt(formData.budgetedMinutes) : null,
      actualHours: formData.actualHours ? parseInt(formData.actualHours) : null,
      actualMinutes: formData.actualMinutes ? parseInt(formData.actualMinutes) : null,
      memberIds: selectedMemberIds,
    });
  };

  return (
    <div className="w-full p-4 sm:p-6 space-y-4 sm:space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">New Project</h1>
          <p className="text-sm text-muted-foreground">Add a new project to track in your CRM</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => navigate("/crm")}
          data-testid="button-back-crm"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderKanban className="h-5 w-5" />
            Project Information
          </CardTitle>
          <CardDescription>Fill in the details for your new project</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Project Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Enter project name"
                data-testid="input-project-name"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter project description"
                rows={4}
                data-testid="textarea-project-description"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="client">Contact (Optional)</Label>
              <Popover open={contactOpen} onOpenChange={setContactOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={contactOpen}
                    className="w-full justify-between font-normal"
                    data-testid="select-project-contact"
                  >
                    {selectedClient 
                      ? `${selectedClient.name}${selectedClient.company ? ` (${selectedClient.company})` : ""}`
                      : "Search for a contact..."
                    }
                    <div className="flex items-center gap-1">
                      {selectedClient && (
                        <X 
                          className="h-4 w-4 opacity-50 hover:opacity-100" 
                          onClick={(e) => {
                            e.stopPropagation();
                            setFormData({ ...formData, clientId: "" });
                          }}
                        />
                      )}
                      <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                    </div>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search contacts by name or company..." data-testid="input-search-contact" />
                    <CommandList>
                      <CommandEmpty>No contact found.</CommandEmpty>
                      <CommandGroup>
                        {clients.map((client) => (
                          <CommandItem
                            key={client.id}
                            value={`${client.name} ${client.company || ""}`}
                            onSelect={() => {
                              setFormData({ ...formData, clientId: client.id });
                              setContactOpen(false);
                            }}
                            data-testid={`option-contact-${client.id}`}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                formData.clientId === client.id ? "opacity-100" : "opacity-0"
                              )}
                            />
                            <div className="flex flex-col">
                              <span>{client.name}</span>
                              {client.company && (
                                <span className="text-xs text-muted-foreground">{client.company}</span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>

            {/* Members field */}
            <div className="space-y-2">
              <Label className="flex items-center gap-1">
                <Users className="w-4 h-4" />
                Members
              </Label>
              <Popover open={membersOpen} onOpenChange={setMembersOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={membersOpen}
                    className="w-full justify-between font-normal"
                    data-testid="select-project-members"
                  >
                    {selectedMemberIds.length === 0
                      ? "Select members..."
                      : `${selectedMemberIds.length} member${selectedMemberIds.length > 1 ? "s" : ""} selected`}
                    <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[400px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search users..." data-testid="input-search-members" />
                    <CommandList>
                      <CommandEmpty>No users found.</CommandEmpty>
                      <CommandGroup>
                        {allUsers.map((u) => {
                          const isSelected = selectedMemberIds.includes(u.id);
                          const displayName = u.firstName || u.lastName
                            ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim()
                            : u.email;
                          return (
                            <CommandItem
                              key={u.id}
                              value={`${u.firstName ?? ""} ${u.lastName ?? ""} ${u.email}`}
                              onSelect={() => {
                                setSelectedMemberIds(prev =>
                                  isSelected ? prev.filter(id => id !== u.id) : [...prev, u.id]
                                );
                              }}
                              data-testid={`option-member-${u.id}`}
                            >
                              <Check className={cn("mr-2 h-4 w-4", isSelected ? "opacity-100" : "opacity-0")} />
                              <Avatar className="w-5 h-5 mr-2">
                                <AvatarImage src={u.profileImageUrl || undefined} />
                                <AvatarFallback className="text-xs">{u.firstName?.[0]}{u.lastName?.[0]}</AvatarFallback>
                              </Avatar>
                              <div className="flex flex-col">
                                <span>{displayName}</span>
                                {u.email && displayName !== u.email && (
                                  <span className="text-xs text-muted-foreground">{u.email}</span>
                                )}
                              </div>
                              {u.id === user?.id && (
                                <span className="ml-auto text-xs text-muted-foreground">you</span>
                              )}
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              {/* Selected members chips */}
              {selectedMemberIds.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {selectedMemberIds.map(id => {
                    const u = allUsers.find(usr => usr.id === id);
                    const displayName = u
                      ? (u.firstName || u.lastName ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : u.email)
                      : id;
                    return (
                      <div
                        key={id}
                        className="flex items-center gap-1 bg-muted rounded-md px-2 py-1 text-sm"
                        data-testid={`selected-member-${id}`}
                      >
                        <Avatar className="w-4 h-4">
                          <AvatarImage src={u?.profileImageUrl || undefined} />
                          <AvatarFallback className="text-xs">{u?.firstName?.[0]}{u?.lastName?.[0]}</AvatarFallback>
                        </Avatar>
                        <span>{displayName}</span>
                        {id === user?.id && <span className="text-muted-foreground text-xs">(you)</span>}
                        <button
                          type="button"
                          onClick={() => setSelectedMemberIds(prev => prev.filter(mid => mid !== id))}
                          className="ml-1 text-muted-foreground hover:text-foreground"
                          data-testid={`remove-member-chip-${id}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select 
                value={formData.status} 
                onValueChange={(v) => setFormData({ ...formData, status: v as CrmProjectStatus })}
              >
                <SelectTrigger data-testid="select-project-status">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map(status => (
                    <SelectItem key={status} value={status}>
                      <div className="flex items-center gap-2">
                        <Badge 
                          className="text-xs"
                          style={{ backgroundColor: statusConfig[status]?.color || "#64748b", color: "white" }}
                        >
                          {statusConfig[status]?.label || status}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="projectType">Project Type</Label>
              <Select 
                value={formData.projectType} 
                onValueChange={(v) => setFormData({ ...formData, projectType: v as CrmProjectType })}
              >
                <SelectTrigger data-testid="select-project-type">
                  <SelectValue placeholder="Select project type" />
                </SelectTrigger>
                <SelectContent>
                  {projectTypeOptions.map(type => (
                    <SelectItem key={type} value={type}>
                      <div className="flex items-center gap-2">
                        <Badge 
                          className="text-xs"
                          style={{ backgroundColor: projectTypeConfig[type]?.color || "#64748b", color: "white" }}
                        >
                          {projectTypeConfig[type]?.label || type}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Start Date <span className="text-destructive">*</span></Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-left font-normal"
                    data-testid="datepicker-start-date"
                  >
                    <CalendarDays className="mr-2 h-4 w-4" />
                    {formData.startDate ? format(formData.startDate, "PPP") : <span className="text-muted-foreground">Select start date</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={formData.startDate || undefined}
                    onSelect={(date) => setFormData({ ...formData, startDate: date || null })}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Budgeted Time</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      id="budgetedHours"
                      type="number"
                      min="0"
                      value={formData.budgetedHours}
                      onChange={(e) => setFormData({ ...formData, budgetedHours: e.target.value })}
                      placeholder="0"
                      data-testid="input-budgeted-hours"
                    />
                    <span className="text-xs text-muted-foreground">Hours</span>
                  </div>
                  <div className="flex-1">
                    <Input
                      id="budgetedMinutes"
                      type="number"
                      min="0"
                      max="59"
                      value={formData.budgetedMinutes}
                      onChange={(e) => {
                        const mins = e.target.value ? Math.min(59, Math.max(0, parseInt(e.target.value))).toString() : "";
                        setFormData({ ...formData, budgetedMinutes: mins });
                      }}
                      placeholder="0"
                      data-testid="input-budgeted-minutes"
                    />
                    <span className="text-xs text-muted-foreground">Minutes</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Actual Time</Label>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      id="actualHours"
                      type="number"
                      min="0"
                      value={formData.actualHours}
                      onChange={(e) => setFormData({ ...formData, actualHours: e.target.value })}
                      placeholder="0"
                      data-testid="input-actual-hours"
                    />
                    <span className="text-xs text-muted-foreground">Hours</span>
                  </div>
                  <div className="flex-1">
                    <Input
                      id="actualMinutes"
                      type="number"
                      min="0"
                      max="59"
                      value={formData.actualMinutes}
                      onChange={(e) => {
                        const mins = e.target.value ? Math.min(59, Math.max(0, parseInt(e.target.value))).toString() : "";
                        setFormData({ ...formData, actualMinutes: mins });
                      }}
                      placeholder="0"
                      data-testid="input-actual-minutes"
                    />
                    <span className="text-xs text-muted-foreground">Minutes</span>
                  </div>
                </div>
              </div>
            </div>

            {calculateDueDate && (
              <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
                <Clock className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm">
                  <span className="text-muted-foreground">Due Date: </span>
                  <span className="font-medium" data-testid="text-due-date">{format(calculateDueDate, "PPP")}</span>
                  {formData.projectType === "hourly_budget" && (
                    <span className="text-xs text-muted-foreground ml-2">({hoursPerDay}h/day)</span>
                  )}
                  {formData.projectType === "one_time" && (
                    <span className="text-xs text-muted-foreground ml-2">(1 week)</span>
                  )}
                  {formData.projectType === "monthly" && (
                    <span className="text-xs text-muted-foreground ml-2">(1 month)</span>
                  )}
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-4">
              <Link href="/crm" className="w-full sm:w-auto">
                <Button type="button" variant="outline" className="w-full" data-testid="button-cancel-project">
                  Cancel
                </Button>
              </Link>
              <Button 
                type="submit" 
                disabled={createProjectMutation.isPending}
                className="w-full sm:w-auto"
                data-testid="button-submit-project"
              >
                <Save className="h-4 w-4 mr-2" />
                {createProjectMutation.isPending ? "Creating..." : "Create Project"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
