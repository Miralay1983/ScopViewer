const BASE = '/api';

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${url}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Bir hata oluştu');
  }

  return data as T;
}

// Auth
export const api = {
  login: (username: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  register: (username: string, password: string, confirmPassword: string) =>
    request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, confirmPassword }),
    }),

  logout: () =>
    request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

  me: () =>
    request<{ user: User }>('/auth/me'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: boolean }>('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // Users (admin)
  getUsers: () =>
    request<{ users: User[] }>('/users'),

  createUser: (data: { username: string; password: string; displayName?: string; role?: string }) =>
    request<{ user: User }>('/users', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/users/${id}`, { method: 'DELETE' }),

  // Projects
  getProjects: () =>
    request<{ projects: Project[] }>('/projects'),

  createProject: (name: string, description?: string) =>
    request<{ project: Project }>('/projects', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),

  deleteProject: (id: number) =>
    request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),

  // Files
  getFiles: (projectId: number) =>
    request<{ files: IFCFile[] }>(`/projects/${projectId}/files`),

  uploadFile: async (projectId: number, file: File): Promise<{ file: IFCFile }> => {
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${BASE}/projects/${projectId}/files`, {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Dosya yüklenemedi');
    }

    return res.json();
  },

  deleteFile: (id: number) =>
    request<{ ok: boolean }>(`/files/${id}`, { method: 'DELETE' }),

  getFileDownloadUrl: (id: number) => `${BASE}/files/${id}/download`,
};

// Types
export interface User {
  id: number;
  username: string;
  displayName?: string;
  display_name?: string;
  role: string;
  is_active?: number;
  created_at?: string;
}

export interface Project {
  id: number;
  user_id?: number;
  name: string;
  description: string;
  file_count: number;
  total_size: number;
  created_at?: string;
  updated_at?: string;
}

export interface IFCFile {
  id: number;
  original_name: string;
  file_size: number;
  uploaded_at: string;
}
