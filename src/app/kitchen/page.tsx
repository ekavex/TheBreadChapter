import KitchenDisplay from '@/components/kitchen/KitchenDisplay'

// Hardcoded for demo — in production, read cafeId from auth session
const DEMO_CAFE_ID = '11111111-1111-1111-1111-111111111111'

export const metadata = { title: 'Kitchen Display' }

export default function KitchenPage() {
  return <KitchenDisplay cafeId={DEMO_CAFE_ID} />
}
