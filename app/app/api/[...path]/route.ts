import { env } from 'cloudflare:workers';
import { handleApi } from '../../../lib/server/api.ts';
export async function GET(request:Request){if(!env.DB)return Response.json({error:'База данных не подключена'},{status:503});return handleApi(request,env.DB);}
export const POST=GET;
