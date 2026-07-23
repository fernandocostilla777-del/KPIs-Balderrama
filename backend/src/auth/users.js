const userStore = require('./userStore');

function authenticate(username, password) {
  return userStore.authenticateUser(username, password);
}

module.exports = {
  authenticate,
  listUsers: userStore.listUsers,
  createUser: userStore.createUser,
  updateUser: userStore.updateUser,
  deleteUser: userStore.deleteUser,
  getAssignableRoles: userStore.getAssignableRoles,
  revealPassword: userStore.revealPassword,
};
