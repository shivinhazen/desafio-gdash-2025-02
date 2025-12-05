export const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api';
export const API_ORIGIN = API_BASE.replace(/\/api$/, '');

export type ApiError = {
  message?: string;
  status?: number;
};

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let payload: ApiError | undefined;
    try {
      payload = await response.json();
    } catch {
      // fall back to status text
    }
    const message = payload?.message ?? response.statusText;
    const error = new Error(message);
    (error as ApiError).status = response.status;
    throw error;
  }
  return response.json();
}

function authHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
  };
}

export type WeatherLog = {
  id: string;
  city: string;
  timestamp: string;
  source: string;
  metrics: Record<string, string | number>;
  meta: Record<string, string>;
};

export type SafeUser = {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type WeatherInsightsPayload = {
  totalLogs: number;
  latestCity?: string;
  latestSource?: string;
  latestTimestamp?: string;
  averageTemperature?: number;
  averageHumidity?: number;
  minTemperature?: number;
  maxTemperature?: number;
  maxWindSpeed?: number;
  rainAlert: boolean;
};

export type WeatherLogsRequestOptions = {
  page?: number;
  limit?: number;
  start?: string;
  end?: string;
  rainOnly?: boolean;
  windOnly?: boolean;
};

export async function apiLogin(email: string, password: string) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  return handleResponse<{ access_token: string }>(response);
}

export async function apiWeatherLogs(
  token: string,
  options: WeatherLogsRequestOptions = {},
) {
  const query = new URLSearchParams()
  if (options.page) {
    query.set('page', String(options.page))
  }
  if (options.limit) {
    query.set('limit', String(options.limit))
  }
  if (options.start) {
    query.set('start', options.start)
  }
  if (options.end) {
    query.set('end', options.end)
  }
  if (options.rainOnly !== undefined) {
    query.set('rainOnly', String(options.rainOnly))
  }
  if (options.windOnly !== undefined) {
    query.set('windOnly', String(options.windOnly))
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  const response = await fetch(`${API_BASE}/weather/logs${suffix}`, {
    headers: {
      ...authHeaders(token),
    },
  })
  return handleResponse<{ total: number; items: WeatherLog[] }>(response)
}

export async function apiExportWeather(token: string, format: 'csv' | 'xlsx') {
  const response = await fetch(`${API_BASE}/weather/export.${format}`, {
    headers: {
      ...authHeaders(token),
    },
  });
  if (!response.ok) {
    throw new Error('Não foi possível gerar o arquivo');
  }
  const blob = await response.blob();
  return {
    blob,
    filename: `weather.${format}`,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
}

export async function apiUsers(token: string) {
  const response = await fetch(`${API_BASE}/users?limit=20`, {
    headers: {
      ...authHeaders(token),
    },
  });
  return handleResponse<{ total: number; items: SafeUser[] }>(response);
}

export async function apiCreateUser(token: string, payload: { name: string; email: string; password: string }) {
  const response = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<SafeUser>(response);
}

export async function apiUpdateUser(
  token: string,
  id: string,
  payload: { name?: string; email?: string; password?: string; isAdmin?: boolean },
) {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(token),
    },
    body: JSON.stringify(payload),
  });
  return handleResponse<SafeUser>(response);
}

export async function apiCurrentUser(token: string) {
  const response = await fetch(`${API_BASE}/auth/me`, {
    headers: {
      ...authHeaders(token),
    },
  });
  return handleResponse<SafeUser>(response);
}

export async function apiDeleteUser(token: string, id: string) {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    method: 'DELETE',
    headers: {
      ...authHeaders(token),
    },
  });
  return handleResponse<SafeUser>(response);
}

export async function apiInsights(token: string) {
  const response = await fetch(`${API_BASE}/weather/insights`, {
    headers: {
      ...authHeaders(token),
    },
  });
  return handleResponse<WeatherInsightsPayload>(response);
}
