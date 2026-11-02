import { Alert } from "react-native";
import { editConfirmText } from "@/lib/chat/phoneEdit";

/**
 * Asked before an edit drops messages (the desktop's `ChatEditConfirm`), as
 * an iOS alert: the conversation goes back to just before the message, and
 * what came after it leaves the column.
 */
export function confirmEdit(later: number, onConfirm: () => void) {
  const { title, message } = editConfirmText(later);
  Alert.alert(title, message, [
    { text: "Annuler", style: "cancel" },
    { text: "Revenir et modifier", style: "destructive", onPress: onConfirm },
  ]);
}
