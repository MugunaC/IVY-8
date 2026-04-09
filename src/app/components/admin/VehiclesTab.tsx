import { useState, useEffect } from 'react';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/app/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/app/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/app/components/ui/select';
import { Badge } from '@/app/components/ui/badge';
import { Checkbox } from '@/app/components/ui/checkbox';
import { Car, ChevronLeft, ChevronRight, Edit, Plus, Trash2, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import type { User, Vehicle } from '@shared/types';
import {
  addVehicle,
  assignUsers,
  getVehicles,
  removeVehicle,
  updateVehicle,
} from '@/app/data/vehiclesRepo';
import { getUsers } from '@/app/data/usersRepo';

export function VehiclesTab() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [editingVehicle, setEditingVehicle] = useState<Vehicle | null>(null);
  const [assigningVehicle, setAssigningVehicle] = useState<Vehicle | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [formData, setFormData] = useState({
    model: '',
    status: 'available' as Vehicle['status'],
    condition: '',
    location: '',
    charge: 100,
  });

  useEffect(() => {
    void loadVehicles();
    void loadUsers();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsAddDialogOpen(false);
      setIsEditDialogOpen(false);
      setIsAssignDialogOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const loadVehicles = async () => {
    try {
      setVehicles(await getVehicles());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load vehicles');
    }
  };

  const loadUsers = async () => {
    try {
      setUsers(await getUsers());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load users');
    }
  };

  const handleAddVehicle = async () => {
    const newVehicle: Vehicle = {
      id: `VH-${String(vehicles.length + 1).padStart(3, '0')}`,
      model: formData.model,
      status: formData.status,
      condition: formData.condition,
      assignedUsers: [],
      location: formData.location,
      charge: formData.charge,
    };

    const updated = await addVehicle(newVehicle);
    setVehicles(updated);
    setIsAddDialogOpen(false);
    resetForm();
    toast.success('Vehicle added successfully');
  };

  const handleEditVehicle = async () => {
    if (!editingVehicle) return;

    const updated = await updateVehicle(editingVehicle.id, {
      model: formData.model,
      status: formData.status,
      condition: formData.condition,
      location: formData.location,
      charge: formData.charge,
    });

    setVehicles(updated);
    setIsEditDialogOpen(false);
    setEditingVehicle(null);
    resetForm();
    toast.success('Vehicle updated successfully');
  };

  const handleDeleteVehicle = async (vehicleId: string) => {
    const updated = await removeVehicle(vehicleId);
    setVehicles(updated);
    toast.success('Vehicle deleted successfully');
  };

  const handleAssignUsers = async (selectedUserIds: string[]) => {
    if (!assigningVehicle) return;

    const updated = await assignUsers(assigningVehicle.id, selectedUserIds);
    setVehicles(updated);
    setIsAssignDialogOpen(false);
    setAssigningVehicle(null);
    toast.success('Vehicle assignments updated');
  };

  const openEditDialog = (vehicle: Vehicle) => {
    setEditingVehicle(vehicle);
    setFormData({
      model: vehicle.model,
      status: vehicle.status,
      condition: vehicle.condition,
      location: vehicle.location,
      charge: vehicle.charge,
    });
    setIsEditDialogOpen(true);
  };

  const openAssignDialog = (vehicle: Vehicle) => {
    setAssigningVehicle(vehicle);
    setIsAssignDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      model: '',
      status: 'available',
      condition: '',
      location: '',
      charge: 100,
    });
  };

  const totalVehicles = vehicles.length;
  const totalPages = Math.max(1, Math.ceil(totalVehicles / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalVehicles);
  const pageVehicles = vehicles.slice(startIndex, endIndex);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  const getStatusBadge = (status: Vehicle['status']) => {
    switch (status) {
      case 'available':
        return (
          <Badge className="border-emerald-500/35 bg-emerald-500/14 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/16 dark:text-emerald-200">
            Available
          </Badge>
        );
      case 'unavailable':
        return (
          <Badge className="border-amber-500/35 bg-amber-500/14 text-amber-900 dark:border-amber-400/40 dark:bg-amber-400/16 dark:text-amber-200">
            Unavailable
          </Badge>
        );
      case 'maintenance':
        return (
          <Badge className="border-red-500/35 bg-red-500/14 text-red-800 dark:border-red-400/40 dark:bg-red-400/16 dark:text-red-200">
            Maintenance
          </Badge>
        );
      default:
        return <Badge>{status}</Badge>;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Vehicle Management</CardTitle>
            <CardDescription>
              Manage fleet vehicles and assignments
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                Add Vehicle
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Vehicle</DialogTitle>
                <DialogDescription>
                  Register a new vehicle in the system
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="add-model">Model</Label>
                  <Input
                    id="add-model"
                    value={formData.model}
                    onChange={(e) =>
                      setFormData({ ...formData, model: e.target.value })
                    }
                    placeholder="e.g., Tesla Model 3"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-status">Status</Label>
                  <Select
                    value={formData.status}
                    onValueChange={(value: Vehicle['status']) =>
                      setFormData({ ...formData, status: value })
                    }
                  >
                    <SelectTrigger id="add-status">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">Available</SelectItem>
                      <SelectItem value="unavailable">Unavailable</SelectItem>
                      <SelectItem value="maintenance">Maintenance</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-condition">Condition</Label>
                  <Input
                    id="add-condition"
                    value={formData.condition}
                    onChange={(e) =>
                      setFormData({ ...formData, condition: e.target.value })
                    }
                    placeholder="e.g., Excellent"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-location">Location</Label>
                  <Input
                    id="add-location"
                    value={formData.location}
                    onChange={(e) =>
                      setFormData({ ...formData, location: e.target.value })
                    }
                    placeholder="e.g., Garage A"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-charge">Charge (%)</Label>
                  <Input
                    id="add-charge"
                    type="number"
                    min="0"
                    max="100"
                    value={formData.charge}
                    onChange={(e) =>
                      setFormData({ ...formData, charge: parseInt(e.target.value || '0', 10) })
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsAddDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={() => void handleAddVehicle()}>Add Vehicle</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-14">No.</TableHead>
                  <TableHead>Vehicle ID</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Condition</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Charge</TableHead>
                  <TableHead>Assigned Users</TableHead>
                  <TableHead>Current User</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pageVehicles.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="py-10 text-center text-muted-foreground">
                      <Car className="mx-auto mb-2 size-12 text-muted-foreground" />
                      No vehicles found
                    </TableCell>
                  </TableRow>
                ) : (
                  pageVehicles.map((vehicle, index) => (
                    <TableRow key={vehicle.id}>
                      <TableCell className="text-xs text-muted-foreground">
                        {startIndex + index + 1}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{vehicle.id}</TableCell>
                      <TableCell className="font-medium">{vehicle.model}</TableCell>
                      <TableCell>{getStatusBadge(vehicle.status)}</TableCell>
                    <TableCell>{vehicle.condition}</TableCell>
                    <TableCell>{vehicle.location}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-16 rounded-full bg-muted">
                          <div
                            className={`h-2 rounded-full ${
                              vehicle.charge > 60
                                ? 'bg-green-500'
                                : vehicle.charge > 30
                                ? 'bg-yellow-500'
                                : 'bg-red-500'
                            }`}
                            style={{ width: `${vehicle.charge}%` }}
                          />
                        </div>
                        <span className="text-sm">{vehicle.charge}%</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {vehicle.assignedUsers.length} user(s)
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">
                        {vehicle.currentUser || '-'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditDialog(vehicle)}
                          title="Edit"
                        >
                          <Edit className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openAssignDialog(vehicle)}
                          title="Assign Users"
                        >
                          <UserPlus className="size-4 text-blue-600 dark:text-blue-300" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDeleteVehicle(vehicle.id)}
                          title="Delete"
                        >
                          <Trash2 className="size-4 text-red-600 dark:text-red-300" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
          <div>
            {totalVehicles === 0 ? '0-0 of 0' : `${startIndex + 1}-${endIndex} of ${totalVehicles}`}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={safePage <= 1}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={safePage >= totalPages}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Vehicle</DialogTitle>
              <DialogDescription>
                Update vehicle information
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-model">Model</Label>
                <Input
                  id="edit-model"
                  value={formData.model}
                  onChange={(e) =>
                    setFormData({ ...formData, model: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-status">Status</Label>
                <Select
                  value={formData.status}
                  onValueChange={(value: Vehicle['status']) =>
                    setFormData({ ...formData, status: value })
                  }
                >
                  <SelectTrigger id="edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="available">Available</SelectItem>
                    <SelectItem value="unavailable">Unavailable</SelectItem>
                    <SelectItem value="maintenance">Maintenance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-condition">Condition</Label>
                <Input
                  id="edit-condition"
                  value={formData.condition}
                  onChange={(e) =>
                    setFormData({ ...formData, condition: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-location">Location</Label>
                <Input
                  id="edit-location"
                  value={formData.location}
                  onChange={(e) =>
                    setFormData({ ...formData, location: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-charge">Charge (%)</Label>
                <Input
                  id="edit-charge"
                  type="number"
                  min="0"
                  max="100"
                  value={formData.charge}
                  onChange={(e) =>
                    setFormData({ ...formData, charge: parseInt(e.target.value || '0', 10) })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleEditVehicle()}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AssignUsersDialog
          vehicle={assigningVehicle}
          users={users}
          isOpen={isAssignDialogOpen}
          onClose={() => setIsAssignDialogOpen(false)}
          onAssign={handleAssignUsers}
        />
      </CardContent>
    </Card>
  );
}

function AssignUsersDialog({
  vehicle,
  users,
  isOpen,
  onClose,
  onAssign,
}: {
  vehicle: Vehicle | null;
  users: User[];
  isOpen: boolean;
  onClose: () => void;
  onAssign: (userIds: string[]) => void;
}) {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);

  useEffect(() => {
    if (vehicle) {
      setSelectedUsers(vehicle.assignedUsers);
    }
  }, [vehicle]);

  const handleToggleUser = (userId: string) => {
    setSelectedUsers((prev) =>
      prev.includes(userId)
        ? prev.filter((id) => id !== userId)
        : [...prev, userId]
    );
  };

  const handleSubmit = () => {
    onAssign(selectedUsers);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Assign Users to Vehicle</DialogTitle>
          <DialogDescription>
            Select users who can access {vehicle?.model} ({vehicle?.id})
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="space-y-2 max-h-[300px] overflow-y-auto">
            {users.map((user) => (
              <div
                key={user.id}
                className="flex items-center space-x-2 p-2 hover:bg-gray-50 rounded"
              >
                <Checkbox
                  id={`user-${user.id}`}
                  checked={selectedUsers.includes(user.id)}
                  onCheckedChange={() => handleToggleUser(user.id)}
                />
                <label
                  htmlFor={`user-${user.id}`}
                  className="flex-1 cursor-pointer"
                >
                  {user.username} ({user.id})
                </label>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>
            Assign {selectedUsers.length} User(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

