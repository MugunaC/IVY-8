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
import { ChevronLeft, ChevronRight, Edit, Plus, Trash2, UserCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { User } from '@shared/types';
import { getUsers, addUser, updateUser, removeUser } from '@/app/data/usersRepo';

export function UsersTab() {
  const [users, setUsers] = useState<User[]>([]);
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    role: 'user' as 'admin' | 'user',
    password: '',
  });

  useEffect(() => {
    void loadUsers();
  }, []);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setIsAddDialogOpen(false);
      setIsEditDialogOpen(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, []);

  const loadUsers = async () => {
    try {
      setUsers(await getUsers());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load users');
    }
  };

  const handleAddUser = async () => {
    try {
      const updated = await addUser({
        username: formData.username.trim(),
        email: formData.email.trim() || undefined,
        role: formData.role,
        password: formData.password,
      });
      setUsers(updated);
      setIsAddDialogOpen(false);
      setFormData({ username: '', email: '', role: 'user', password: '' });
      toast.success('User added successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to add user');
    }
  };

  const handleEditUser = async () => {
    if (!editingUser) return;

    try {
      const updated = await updateUser(editingUser.id, {
        username: formData.username.trim(),
        email: formData.email.trim() || undefined,
        role: formData.role,
        password: formData.password || undefined,
      });

      setUsers(updated);
      setIsEditDialogOpen(false);
      setEditingUser(null);
      setFormData({ username: '', email: '', role: 'user', password: '' });
      toast.success('User updated successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update user');
    }
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const updated = await removeUser(userId);
      setUsers(updated);
      toast.success('User deleted successfully');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete user');
    }
  };

  const openEditDialog = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email || '',
      role: user.role,
      password: '',
    });
    setIsEditDialogOpen(true);
  };

  const totalUsers = users.length;
  const totalPages = Math.max(1, Math.ceil(totalUsers / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalUsers);
  const pageUsers = users.slice(startIndex, endIndex);

  useEffect(() => {
    if (page !== safePage) {
      setPage(safePage);
    }
  }, [page, safePage]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>User Management</CardTitle>
            <CardDescription>
              View and manage all system users
            </CardDescription>
          </div>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                Add User
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New User</DialogTitle>
                <DialogDescription>
                  Create a new user account for the system
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="add-username">Username</Label>
                  <Input
                    id="add-username"
                    value={formData.username}
                    onChange={(e) =>
                      setFormData({ ...formData, username: e.target.value })
                    }
                    placeholder="Enter username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-email">Email</Label>
                  <Input
                    id="add-email"
                    type="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    placeholder="Enter email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-role">Role</Label>
                  <Select
                    value={formData.role}
                    onValueChange={(value: 'admin' | 'user') =>
                      setFormData({ ...formData, role: value })
                    }
                  >
                    <SelectTrigger id="add-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="user">User</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="add-password">Password</Label>
                  <Input
                    id="add-password"
                    type="password"
                    value={formData.password}
                    onChange={(e) =>
                      setFormData({ ...formData, password: e.target.value })
                    }
                    placeholder="Minimum 8 characters"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setIsAddDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button onClick={() => void handleAddUser()}>Add User</Button>
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
                <TableHead>User ID</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageUsers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    <UserCircle className="size-12 mx-auto mb-2 text-muted-foreground" />
                    No users found
                  </TableCell>
                </TableRow>
              ) : (
                pageUsers.map((user, index) => (
                  <TableRow key={user.id}>
                    <TableCell className="text-xs text-muted-foreground">
                      {startIndex + index + 1}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{user.id}</TableCell>
                    <TableCell className="font-medium">{user.username}</TableCell>
                    <TableCell>{user.email || '-'}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${
                          user.role === 'admin'
                            ? 'border-sky-500/35 bg-sky-500/14 text-sky-800 dark:border-sky-400/40 dark:bg-sky-400/16 dark:text-sky-200'
                            : 'border-emerald-500/35 bg-emerald-500/14 text-emerald-800 dark:border-emerald-400/40 dark:bg-emerald-400/16 dark:text-emerald-200'
                        }`}
                      >
                        {user.role}
                      </span>
                    </TableCell>
                    <TableCell>
                      {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => openEditDialog(user)}
                        >
                          <Edit className="size-4" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleDeleteUser(user.id)}
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
            {totalUsers === 0 ? '0-0 of 0' : `${startIndex + 1}-${endIndex} of ${totalUsers}`}
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
              <DialogTitle>Edit User</DialogTitle>
              <DialogDescription>
                Update user information
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-username">Username</Label>
                <Input
                  id="edit-username"
                  value={formData.username}
                  onChange={(e) =>
                    setFormData({ ...formData, username: e.target.value })
                  }
                  placeholder="Enter username"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                  placeholder="Enter email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-role">Role</Label>
                <Select
                  value={formData.role}
                  onValueChange={(value: 'admin' | 'user') =>
                    setFormData({ ...formData, role: value })
                  }
                >
                  <SelectTrigger id="edit-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-password">Reset Password (optional)</Label>
                <Input
                  id="edit-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) =>
                    setFormData({ ...formData, password: e.target.value })
                  }
                  placeholder="Leave blank to keep current password"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsEditDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleEditUser()}>Save Changes</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

