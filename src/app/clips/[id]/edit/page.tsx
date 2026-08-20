import EditClipClient from "./EditClipClient";

export default function EditClipPage({ params }: { params: { id: string } }) {
  return <EditClipClient clipId={params.id} />;
}
