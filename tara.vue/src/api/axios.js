import axios from 'axios';

// 1. Axios 인스턴스 생성
const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL, // .env에서 설정한 주소
    headers: {
        'Content-Type': 'application/json',
    },
    timeout: 10000, // 요청 타임아웃 (10초)
});

apiClient.interceptors.request.use(
    (config) => {
        // const token = localStorage.getItem('token');
        // if (token) config.headers.Authorization = `Bearer ${token}`;
        return config;
    },
    (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        console.error('[API Error]', error);
        return Promise.reject(error);
    }
);

export default apiClient;