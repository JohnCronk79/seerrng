#!/bin/bash

source /usr/share/yunohost/helpers

seerrng_seed_settings() {
	local settings_file="$data_dir/settings.json"

	if [[ -L "$settings_file" ]]; then
		ynh_die --message="Refusing to initialize SeerrNG settings through a symlink."
	fi

	if [[ -e "$settings_file" ]]; then
		if [[ ! -f "$settings_file" ]]; then
			ynh_die --message="SeerrNG settings path exists but is not a regular file."
		fi
		return
	fi

	install -o "$app" -g "$app" -m 0600 /dev/null "$settings_file"
	printf '%s\n' '{"network":{"trustProxy":true}}' > "$settings_file"
	chown "$app:$app" "$settings_file"
	chmod 0600 "$settings_file"
}

seerrng_prepare_service() {
	local log_directory="$data_dir/logs"

	if [[ -L "$log_directory" ]]; then
		ynh_die --message="Refusing to use a symlink as the SeerrNG log directory."
	fi
	mkdir -p "$log_directory"
	chown "$app:$app" "$log_directory"
	chmod 0700 "$log_directory"
	ynh_config_add_nginx
	ynh_config_add_systemd
}

seerrng_register_service() {
	local log_file="$data_dir/logs/seerr.log"

	if [[ ! -f "$log_file" ]]; then
		ynh_die --message="SeerrNG did not create its application log during startup."
	fi
	yunohost service add "$app" \
		--description="SeerrNG media request service" \
		--log="$log_file"
}
